package com.opencard.app.updater;

import android.net.Network;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads a release APK into app-private storage. An interrupted download is kept as
 * "<name>.part" and resumed with an HTTP Range request the next time.
 */
public final class ApkDownloader {
    public interface Progress {
        void onProgress(long done, long total);
    }

    private final UpdateConfig cfg;

    public ApkDownloader(UpdateConfig cfg) {
        this.cfg = cfg;
    }

    public File download(Network net, ReleaseInfo r, File target, AtomicBoolean cancel, Progress progress) throws UpdateException {
        File part = new File(target.getPath() + ".part");
        File dir = target.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new UpdateException(UpdateException.Kind.STORAGE, "Couldn't create the download folder.");
        if (target.isFile() && (r.apkSize <= 0 || target.length() == r.apkSize)) return target; // already downloaded
        long have = part.isFile() ? part.length() : 0;
        if (r.apkSize > 0 && have > r.apkSize) {
            part.delete();
            have = 0;
        }
        if (dir != null && r.apkSize > 0 && dir.getUsableSpace() < (r.apkSize - have) + 5L * 1024 * 1024) {
            throw new UpdateException(UpdateException.Kind.STORAGE, "Not enough free space for the update.");
        }
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "application/octet-stream");
        if (have > 0) h.put("Range", "bytes=" + have + "-");
        HttpURLConnection c = null;
        try {
            c = Http.open(net, r.apkUrl, cfg.userAgent(), h);
            int code = c.getResponseCode();
            boolean append = code == 206 && have > 0;
            if (code == 416 && r.apkSize > 0 && have == r.apkSize) {
                append = true; // the part file is already complete
            } else if (code != 200 && code != 206) {
                throw new UpdateException(UpdateException.Kind.BAD_RESPONSE, "The download server answered with an error (" + code + ").");
            }
            if (!append) have = 0;
            long total = r.apkSize > 0 ? r.apkSize : (c.getContentLengthLong() > 0 ? c.getContentLengthLong() + have : -1);
            if (code != 416) {
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part, append)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = have;
                    long lastReport = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancel.get()) throw new UpdateException(UpdateException.Kind.CANCELLED, "Download cancelled.");
                        out.write(buf, 0, n);
                        done += n;
                        if (total > 0 && done > total) throw new UpdateException(UpdateException.Kind.CORRUPT, "The download is larger than expected.");
                        long now = System.currentTimeMillis();
                        if (now - lastReport > 120) {
                            lastReport = now;
                            progress.onProgress(done, total);
                        }
                    }
                    out.flush();
                    progress.onProgress(done, total);
                }
            }
            if (r.apkSize > 0 && part.length() != r.apkSize) {
                throw new UpdateException(UpdateException.Kind.NETWORK, "The download was interrupted.");
            }
            if (target.exists()) target.delete();
            if (!part.renameTo(target)) throw new UpdateException(UpdateException.Kind.STORAGE, "Couldn't save the download.");
            return target;
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Kind.NETWORK, "The connection was lost during the download.", e);
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
