package com.opencard.app.updater;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/**
 * A tiny local HTTPS server for the updater tests (self-signed localhost certificate from the
 * test resources). Uses only javax.net.ssl, which Android unit tests can compile against.
 */
final class TestHttps implements AutoCloseable {
    interface Handler {
        void handle(Exchange ex) throws IOException;
    }

    static final class Headers {
        private final Map<String, List<String>> m = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        String getFirst(String k) {
            List<String> v = m.get(k);
            return v == null || v.isEmpty() ? null : v.get(0);
        }
        void add(String k, String v) {
            m.computeIfAbsent(k, x -> new ArrayList<>()).add(v);
        }
    }

    static final class Exchange {
        final String method, path;
        private final Headers req = new Headers(), resp = new Headers();
        private final OutputStream out;
        private boolean sent;
        Exchange(String method, String path, OutputStream out) {
            this.method = method;
            this.path = path;
            this.out = out;
        }
        Headers getRequestHeaders() { return req; }
        Headers getResponseHeaders() { return resp; }
    }

    private final ServerSocket server;
    private final Map<String, Handler> routes = new LinkedHashMap<>();
    private volatile boolean open = true;
    final String base;

    TestHttps() throws Exception {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (InputStream in = TestHttps.class.getResourceAsStream("/localhost-test-tls.p12")) {
            ks.load(in, "testonly".toCharArray());
        }
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        kmf.init(ks, "testonly".toCharArray());
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ks);
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);
        HttpsURLConnection.setDefaultSSLSocketFactory(ctx.getSocketFactory()); // client trusts only this cert
        server = ctx.getServerSocketFactory().createServerSocket(0, 50, InetAddress.getByName("localhost"));
        base = "https://localhost:" + server.getLocalPort();
        Thread t = new Thread(this::acceptLoop, "test-https");
        t.setDaemon(true);
        t.start();
    }

    void on(String pathPrefix, Handler h) {
        routes.put(pathPrefix, h);
    }

    private void acceptLoop() {
        while (open) {
            try {
                Socket s = server.accept();
                Thread t = new Thread(() -> serve(s), "test-https-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                return;
            }
        }
    }

    private void serve(Socket s) {
        try (Socket sock = s) {
            BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.ISO_8859_1));
            String line = in.readLine();
            if (line == null) return;
            String[] parts = line.split(" ");
            Exchange ex = new Exchange(parts[0], parts[1], sock.getOutputStream());
            while ((line = in.readLine()) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0) ex.req.add(line.substring(0, c).trim(), line.substring(c + 1).trim());
            }
            Handler h = null;
            int best = -1;
            for (Map.Entry<String, Handler> r : routes.entrySet()) {
                if (ex.path.startsWith(r.getKey()) && r.getKey().length() > best) {
                    best = r.getKey().length();
                    h = r.getValue();
                }
            }
            if (h == null) send(ex, 404, "not found".getBytes(StandardCharsets.UTF_8));
            else h.handle(ex);
            if (!ex.sent) send(ex, 500, null);
        } catch (IOException ignored) {
            // client went away
        }
    }

    static void send(Exchange ex, int code, byte[] body) throws IOException {
        if (ex.sent) return;
        ex.sent = true;
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        for (Map.Entry<String, List<String>> e : ex.resp.m.entrySet()) {
            for (String v : e.getValue()) sb.append(e.getKey()).append(": ").append(v).append("\r\n");
        }
        sb.append("Content-Length: ").append(body == null ? 0 : body.length).append("\r\n");
        sb.append("Connection: close\r\n\r\n");
        ex.out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (body != null && !"HEAD".equals(ex.method) && code != 304) ex.out.write(body);
        ex.out.flush();
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 302: return "Found";
            case 304: return "Not Modified";
            case 404: return "Not Found";
            default: return String.valueOf(code).toUpperCase(Locale.ROOT);
        }
    }

    @Override
    public void close() {
        open = false;
        try {
            server.close();
        } catch (IOException ignored) {
            // already closed
        }
    }
}
