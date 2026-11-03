package com.opencard.app.updater;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Checks GitHub for a newer release, downloads and verifies it, and hands it to Android's
 * installer. All network work runs on one background thread and only on Wi-Fi. The UI is told
 * about every change through {@link Listener} as a small JSON state object.
 */
public final class UpdateManager {
    public interface Listener {
        void onUpdateState(JSONObject state);
    }

    private static final String TAG = "Updater";
    private static final String PREFS = "updater";
    private static final String K_AUTO = "autoCheck";
    private static final String K_SKIP = "skippedVersion";
    private static final long STALE_MS = 14L * 24 * 60 * 60 * 1000;

    private static UpdateManager instance;

    public static synchronized UpdateManager get(Context ctx) {
        if (instance == null) instance = new UpdateManager(ctx.getApplicationContext(), UpdateConfig.fromBuild());
        return instance;
    }

    private final Context app;
    private final UpdateConfig cfg;
    private final SharedPreferences prefs;
    private final GitHubReleaseClient client;
    private final ApkDownloader downloader;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean cancel = new AtomicBoolean();

    private Activity activity;
    private Listener listener;
    private boolean launchChecked;

    // state (guarded by this)
    private String state = "idle";
    private boolean auto;
    private ReleaseInfo release;
    private File apk;
    private long done, total;
    private UpdateException error;
    private String message;
    private boolean busy;

    private UpdateManager(Context app, UpdateConfig cfg) {
        this.app = app;
        this.cfg = cfg;
        this.prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.client = new GitHubReleaseClient(cfg, prefs);
        this.downloader = new ApkDownloader(cfg);
        worker.execute(this::cleanupOnStart);
    }

    /* ------------------------------------------------------------------ */
    /* activity / UI wiring                                                */
    /* ------------------------------------------------------------------ */

    public void attach(Activity a, Listener l) {
        activity = a;
        listener = l;
    }

    public void detach(Activity a) {
        if (activity == a) {
            activity = null;
            listener = null;
        }
    }

    /** Called once the game has loaded: one automatic, silent check per app launch (Wi-Fi only). */
    public void onAppLaunched() {
        if (launchChecked || !cfg.enabled() || !isAutoCheck()) return;
        launchChecked = true;
        check(true);
    }

    /** Called from Activity.onResume: continue an install after the user granted permission. */
    public void onResume() {
        boolean go;
        synchronized (this) {
            go = "needs_permission".equals(state) && ApkInstaller.canInstall(app);
        }
        if (go) install();
    }

    public boolean isAutoCheck() {
        return prefs.getBoolean(K_AUTO, true);
    }

    public void setAutoCheck(boolean on) {
        prefs.edit().putBoolean(K_AUTO, on).apply();
        publish();
    }

    /* ------------------------------------------------------------------ */
    /* actions                                                             */
    /* ------------------------------------------------------------------ */

    public void checkNow() {
        check(false);
    }

    private void check(boolean automatic) {
        synchronized (this) {
            if (busy || "downloading".equals(state) || "installing".equals(state)) return;
            busy = true;
            auto = automatic;
            error = null;
            message = null;
            state = "checking";
        }
        publish();
        worker.execute(() -> {
            try {
                Network net = NetworkPolicy.requireWifi(app, automatic);
                ReleaseInfo r = client.latest(net);
                onRelease(r, automatic);
            } catch (UpdateException e) {
                fail(e);
            } catch (RuntimeException e) {
                Log.e(TAG, "check failed", e);
                fail(new UpdateException(UpdateException.Kind.BAD_RESPONSE, "Something went wrong while checking for updates.", e));
            } finally {
                synchronized (this) {
                    busy = false;
                }
            }
        });
    }

    private void onRelease(ReleaseInfo r, boolean automatic) {
        Version installed = Version.parse(cfg.installedVersionName);
        if (!r.version.isNewerThan(installed)) {
            deleteDownloadsExcept(null);
            set("up_to_date", r);
            return;
        }
        File target = apkFile(r);
        deleteDownloadsExcept(target);
        if (automatic && r.version.toString().equals(prefs.getString(K_SKIP, null))) {
            set("skipped", r);
            return;
        }
        if (target.isFile()) {
            // downloaded earlier (e.g. the player chose "Later"): verify again and offer to install
            try {
                ApkVerifier.verify(app, target, expectedDigest(null, r));
                synchronized (this) {
                    apk = target;
                }
                set("ready", r);
                return;
            } catch (UpdateException e) {
                target.delete();
            }
        }
        set("available", r);
    }

    public void download() {
        final ReleaseInfo r;
        synchronized (this) {
            if (busy || release == null) return;
            if (!("available".equals(state) || "error".equals(state) || "skipped".equals(state) || "deferred".equals(state))) return;
            r = release;
            busy = true;
            auto = false;
            error = null;
            message = null;
            done = 0;
            total = r.apkSize;
            state = "downloading";
            cancel.set(false);
        }
        publish();
        worker.execute(() -> {
            File target = apkFile(r);
            try {
                Network net = NetworkPolicy.requireWifi(app, false);
                String expected = expectedDigest(net, r);
                downloader.download(net, r, target, cancel, (d, t) -> {
                    synchronized (this) {
                        done = d;
                        total = t;
                    }
                    publish();
                });
                set("verifying", r);
                try {
                    ApkVerifier.verify(app, target, expected);
                } catch (UpdateException e) {
                    target.delete(); // never keep a file that failed verification
                    throw e;
                }
                synchronized (this) {
                    apk = target;
                }
                set("ready", r);
            } catch (UpdateException e) {
                if (e.kind == UpdateException.Kind.CANCELLED) {
                    deleteDownloadsExcept(null);
                    set("available", r);
                } else {
                    fail(e);
                }
            } catch (RuntimeException e) {
                Log.e(TAG, "download failed", e);
                fail(new UpdateException(UpdateException.Kind.STORAGE, "The download couldn't be completed.", e));
            } finally {
                synchronized (this) {
                    busy = false;
                }
            }
        });
    }

    public void cancelDownload() {
        cancel.set(true);
    }

    public void install() {
        final File file;
        synchronized (this) {
            if (apk == null || !apk.isFile()) return;
            if (!("ready".equals(state) || "needs_permission".equals(state) || "error".equals(state))) return;
            file = apk;
            error = null;
            message = null;
            if (!ApkInstaller.canInstall(app)) {
                state = "needs_permission";
                publishLater();
                return;
            }
            state = "installing";
        }
        publish();
        worker.execute(() -> {
            try {
                ApkInstaller.install(app, file);
            } catch (UpdateException e) {
                fail(e);
            }
        });
    }

    /** Opens Android's "Install unknown apps" screen for this app. The user decides. */
    public void openInstallSettings() {
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.getPackageName()));
        try {
            if (activity != null) activity.startActivity(i);
            else app.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            synchronized (this) {
                message = "Open Android Settings > Apps > Open Card > Install unknown apps, and allow it.";
            }
            publish();
        }
    }

    /** Hide the offer for now; a downloaded file is kept so "Install" works later without re-downloading. */
    public void later() {
        synchronized (this) {
            if ("available".equals(state) || "ready".equals(state) || "error".equals(state) || "needs_permission".equals(state)) {
                state = apk != null && apk.isFile() ? "ready" : "deferred";
                message = null;
            }
        }
        publish();
    }

    /** Don't offer this version automatically again; its download is no longer needed. */
    public void skip() {
        ReleaseInfo r;
        synchronized (this) {
            r = release;
            if (r == null || busy) return;
            apk = null;
            state = "skipped";
        }
        prefs.edit().putString(K_SKIP, r.version.toString()).apply();
        worker.execute(() -> deleteDownloadsExcept(null));
        publish();
    }

    /* ------------------------------------------------------------------ */
    /* installer callbacks                                                 */
    /* ------------------------------------------------------------------ */

    @SuppressWarnings("deprecation")
    void onInstallStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                Intent confirm = Build.VERSION.SDK_INT >= 33
                        ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                        : (Intent) intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm == null) {
                    fail(new UpdateException(UpdateException.Kind.INSTALL_FAILED, "Android didn't show the install screen."));
                    return;
                }
                synchronized (this) {
                    state = "confirming";
                }
                publish();
                try {
                    // Android's own confirmation screen: the player taps Update/Install (or cancels).
                    if (activity != null) activity.startActivity(confirm);
                    else app.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (RuntimeException e) {
                    fail(new UpdateException(UpdateException.Kind.INSTALL_FAILED, "Android didn't show the install screen.", e));
                }
                return;
            }
            case PackageInstaller.STATUS_SUCCESS:
                // Usually the app is restarted by the update before this arrives; cleanup also
                // happens in PackageReplacedReceiver and on the next launch.
                deleteDownloads(app);
                synchronized (this) {
                    apk = null;
                    state = "installed";
                }
                publish();
                return;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                synchronized (this) {
                    state = "ready";
                    message = "The update was cancelled. Tap Install to try again.";
                }
                publish();
                return;
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                fail(new UpdateException(UpdateException.Kind.INSTALL_FAILED, "There isn't enough storage to install the update."));
                return;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
            case PackageInstaller.STATUS_FAILURE_INVALID:
                deleteDownloads(app);
                synchronized (this) {
                    apk = null;
                }
                fail(new UpdateException(UpdateException.Kind.SIGNATURE_MISMATCH, "Android refused the update" + (detail != null ? " (" + detail + ")" : "") + "."));
                return;
            default:
                fail(new UpdateException(UpdateException.Kind.INSTALL_FAILED, "The update couldn't be installed" + (detail != null ? " (" + detail + ")" : "") + "."));
        }
    }

    /* ------------------------------------------------------------------ */
    /* state                                                               */
    /* ------------------------------------------------------------------ */

    private void set(String s, ReleaseInfo r) {
        synchronized (this) {
            state = s;
            if (r != null) release = r;
        }
        publish();
    }

    private void fail(UpdateException e) {
        Log.w(TAG, "update " + e.kind + ": " + e.getMessage(), e.getCause());
        synchronized (this) {
            error = e;
            state = "error";
        }
        publish();
    }

    public synchronized JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            o.put("enabled", cfg.enabled());
            o.put("state", state);
            o.put("auto", auto);
            o.put("autoCheck", isAutoCheck());
            o.put("installed", cfg.installedVersionName);
            o.put("source", cfg.owner + "/" + cfg.repo);
            if (release != null) {
                o.put("latest", release.version.toString());
                o.put("title", release.title);
                o.put("changelog", release.changelog);
                o.put("size", release.apkSize);
                o.put("page", release.pageUrl);
                o.put("skipped", release.version.toString().equals(prefs.getString(K_SKIP, null)));
            }
            o.put("done", done);
            o.put("total", total);
            o.put("hasDownload", apk != null && apk.isFile());
            if (message != null) o.put("message", message);
            if (error != null) {
                o.put("error", error.getMessage());
                o.put("errorKind", error.kind.name());
                o.put("retryable", error.retryable());
                if (error.retryAt > 0) o.put("retryAt", error.retryAt);
            }
        } catch (JSONException ignored) {
            // all values are plain types
        }
        return o;
    }

    private void publish() {
        main.post(() -> {
            Listener l = listener;
            if (l != null) l.onUpdateState(snapshot());
        });
    }

    private void publishLater() {
        publish();
    }

    /* ------------------------------------------------------------------ */
    /* files                                                               */
    /* ------------------------------------------------------------------ */

    static File downloadDir(Context ctx) {
        return new File(ctx.getCacheDir(), "updates");
    }

    private File apkFile(ReleaseInfo r) {
        String safe = r.version.toString().replaceAll("[^0-9.]", "");
        return new File(downloadDir(app), "update-" + safe + ".apk");
    }

    /** Which SHA-256 to trust: the release's checksum file and GitHub's own digest must agree. */
    private String expectedDigest(Network net, ReleaseInfo r) throws UpdateException {
        String fromFile = net != null ? client.checksumFromAsset(net, r) : null;
        if (fromFile != null && r.apkDigest != null && !Checksums.matches(fromFile, r.apkDigest)) {
            throw new UpdateException(UpdateException.Kind.CHECKSUM_MISMATCH, "The release's checksums don't agree, so it isn't safe to install.");
        }
        String d = fromFile != null ? fromFile : r.apkDigest;
        if (d == null) throw new UpdateException(UpdateException.Kind.CHECKSUM_MISSING, "The release has no checksum, so the download can't be verified.");
        return d;
    }

    private void deleteDownloadsExcept(File keep) {
        File[] files = downloadDir(app).listFiles();
        if (files == null) return;
        for (File f : files) {
            if (keep != null && (f.equals(keep) || f.getPath().equals(keep.getPath() + ".part"))) continue;
            if (!f.delete()) Log.w(TAG, "couldn't delete " + f);
        }
    }

    /** Remove leftovers: files for versions that are already installed, and anything stale. */
    private void cleanupOnStart() {
        File[] files = downloadDir(app).listFiles();
        if (files == null) return;
        Version installed = Version.parse(cfg.installedVersionName);
        long now = System.currentTimeMillis();
        for (File f : files) {
            Version v = Version.parse(f.getName());
            if (v == null || !v.isNewerThan(installed) || now - f.lastModified() > STALE_MS) f.delete();
        }
    }

    public static void deleteDownloads(Context ctx) {
        File[] files = downloadDir(ctx).listFiles();
        if (files != null) for (File f : files) f.delete();
    }
}
