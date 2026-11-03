package com.opencard.app.updater;

import android.net.Network;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;

/** Small HTTPS helper. Every connection is bound to the given (Wi-Fi) network. */
final class Http {
    static final int CONNECT_TIMEOUT_MS = 15000;
    static final int READ_TIMEOUT_MS = 30000;

    private Http() {}

    /** Opens a GET request, following up to 5 HTTPS redirects (GitHub serves assets from a CDN). */
    static HttpURLConnection open(Network net, String url, String userAgent, Map<String, String> headers) throws IOException {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            URL u = URI.create(current).toURL();
            if (!"https".equals(u.getProtocol())) throw new IOException("Refusing non-HTTPS URL");
            HttpURLConnection c = (HttpURLConnection) (net != null ? net.openConnection(u) : u.openConnection());
            if (!(c instanceof HttpsURLConnection)) throw new IOException("Not an HTTPS connection");
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setUseCaches(false);
            c.setRequestProperty("User-Agent", userAgent);
            if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Redirect without a location");
                current = URI.create(current).resolve(loc).toString();
                continue;
            }
            return c;
        }
        throw new IOException("Too many redirects");
    }

    static String readText(HttpURLConnection c, int maxBytes) throws IOException {
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > maxBytes) throw new IOException("Response too large");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
