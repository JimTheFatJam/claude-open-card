package com.opencard.app.updater;

import android.content.SharedPreferences;
import android.net.Network;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.Map;

/**
 * Reads the latest release from the GitHub Releases API.
 * Uses ETags so repeat checks are answered with "304 Not Modified", which GitHub
 * doesn't count against the (60 per hour) unauthenticated rate limit.
 */
public final class GitHubReleaseClient {
    private static final String K_ETAG = "etag";
    private static final String K_BODY = "releaseJson";
    private static final String K_URL = "releaseUrl";

    private final UpdateConfig cfg;
    private final SharedPreferences prefs;

    public GitHubReleaseClient(UpdateConfig cfg, SharedPreferences prefs) {
        this.cfg = cfg;
        this.prefs = prefs;
    }

    public ReleaseInfo latest(Network net) throws UpdateException {
        String url = cfg.latestReleaseUrl();
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "application/vnd.github+json");
        h.put("X-GitHub-Api-Version", "2022-11-28");
        String cachedBody = prefs.getString(K_BODY, null);
        if (cachedBody != null && url.equals(prefs.getString(K_URL, null))) {
            String etag = prefs.getString(K_ETAG, null);
            if (etag != null) h.put("If-None-Match", etag);
        }
        HttpURLConnection c = null;
        try {
            c = Http.open(net, url, cfg.userAgent(), h);
            int code = c.getResponseCode();
            if (code == 304 && cachedBody != null) return ReleaseInfo.parse(cachedBody, cfg.apkAsset, cfg.checksumAsset, cfg.allowsPrerelease());
            if (code == 200) {
                String body = Http.readText(c, 2 * 1024 * 1024);
                ReleaseInfo info = ReleaseInfo.parse(body, cfg.apkAsset, cfg.checksumAsset, cfg.allowsPrerelease());
                prefs.edit().putString(K_BODY, body).putString(K_URL, url).putString(K_ETAG, c.getHeaderField("ETag")).apply();
                return info;
            }
            if (code == 404) {
                throw new UpdateException(UpdateException.Kind.NOT_FOUND, "No published release was found for " + cfg.owner + "/" + cfg.repo + ".");
            }
            if (code == 403 || code == 429) {
                String remaining = c.getHeaderField("X-RateLimit-Remaining");
                long reset = parseLong(c.getHeaderField("X-RateLimit-Reset"));
                long retryAfter = parseLong(c.getHeaderField("Retry-After"));
                if (code == 429 || "0".equals(remaining) || retryAfter > 0) {
                    long at = reset > 0 ? reset : retryAfter > 0 ? System.currentTimeMillis() / 1000 + retryAfter : 0;
                    throw new UpdateException(UpdateException.Kind.RATE_LIMITED, "GitHub is limiting update checks right now.", at, null);
                }
                throw new UpdateException(UpdateException.Kind.NOT_FOUND, "The update source can't be accessed.");
            }
            throw new UpdateException(UpdateException.Kind.BAD_RESPONSE, "GitHub answered with an error (" + code + ").");
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Kind.NETWORK, "Couldn't reach GitHub.", e);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Downloads the small "<apk>.sha256" checksum asset and returns the digest, or null if absent. */
    public String checksumFromAsset(Network net, ReleaseInfo r) throws UpdateException {
        if (r.checksumUrl == null) return null;
        HttpURLConnection c = null;
        try {
            c = Http.open(net, r.checksumUrl, cfg.userAgent(), null);
            if (c.getResponseCode() != 200) throw new UpdateException(UpdateException.Kind.BAD_RESPONSE, "Couldn't read the release checksum.");
            return Checksums.fromChecksumFile(Http.readText(c, 64 * 1024), cfg.apkAsset);
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Kind.NETWORK, "Couldn't download the release checksum.", e);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static long parseLong(String s) {
        try {
            return s == null ? 0 : Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
