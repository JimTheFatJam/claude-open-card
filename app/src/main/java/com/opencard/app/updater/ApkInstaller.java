package com.opencard.app.updater;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Installs a verified APK with Android's PackageInstaller. Android always shows its own
 * confirmation screen; the result comes back to {@link InstallResultReceiver}.
 */
public final class ApkInstaller {
    static final String ACTION_STATUS = "com.opencard.app.updater.INSTALL_STATUS";

    private ApkInstaller() {}

    public static boolean canInstall(Context ctx) {
        return ctx.getPackageManager().canRequestPackageInstalls();
    }

    public static void install(Context ctx, File apk) throws UpdateException {
        PackageManager pm = ctx.getPackageManager();
        PackageInstaller installer = pm.getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) {
            // Always ask the user. The updater never tries to install silently.
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        }
        int sessionId = -1;
        PackageInstaller.Session session = null;
        try {
            sessionId = installer.createSession(params);
            session = installer.openSession(sessionId);
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent i = new Intent(ctx, InstallResultReceiver.class).setAction(ACTION_STATUS).setPackage(ctx.getPackageName());
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, sessionId, i, piFlags);
            session.commit(pi.getIntentSender());
            session.close();
            session = null;
        } catch (IOException | RuntimeException e) {
            if (session != null) session.abandon();
            else if (sessionId != -1) {
                try { installer.abandonSession(sessionId); } catch (RuntimeException ignored) { }
            }
            throw new UpdateException(UpdateException.Kind.INSTALL_FAILED, "Android couldn't start the installation.", e);
        }
    }
}
