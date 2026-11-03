package com.opencard.app.updater;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.security.KeyStore;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/** A local HTTPS server (self-signed localhost certificate from test resources) for updater tests. */
final class TestHttps implements AutoCloseable {
    final HttpsServer server;
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
        // the client side trusts only this test certificate
        HttpsURLConnection.setDefaultSSLSocketFactory(ctx.getSocketFactory());
        server = HttpsServer.create(new InetSocketAddress("localhost", 0), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(ctx));
        server.start();
        base = "https://localhost:" + server.getAddress().getPort();
    }

    void on(String path, HttpHandler h) {
        server.createContext(path, h);
    }

    static void send(HttpExchange ex, int code, byte[] body) throws IOException {
        ex.sendResponseHeaders(code, body == null ? -1 : body.length);
        if (body != null) try (OutputStream o = ex.getResponseBody()) {
            o.write(body);
        }
        ex.close();
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
