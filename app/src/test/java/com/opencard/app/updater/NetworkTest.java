package com.opencard.app.updater;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** GitHub client and downloader against a local HTTPS server. */
public class NetworkTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    TestHttps srv;
    UpdateConfig cfg;
    byte[] apk;

    @Before
    public void setUp() throws Exception {
        srv = new TestHttps();
        cfg = new UpdateConfig(srv.base, "o", "r", "OpenCard.apk", "1.0.15", 15);
        apk = new byte[300_000];
        new Random(42).nextBytes(apk);
    }

    @After
    public void tearDown() {
        srv.close();
    }

    String releaseJson(String apkUrl) {
        return "{\"tag_name\":\"v1.0.16\",\"name\":\"v1.0.16\",\"body\":\"Changes\",\"assets\":[{\"name\":\"OpenCard.apk\",\"size\":" + apk.length
                + ",\"digest\":\"sha256:" + Checksums.sha256Hex(apk) + "\",\"browser_download_url\":\"" + apkUrl + "\"},"
                + "{\"name\":\"OpenCard.apk.sha256\",\"browser_download_url\":\"" + srv.base + "/dl/OpenCard.apk.sha256\"}]}";
    }

    @Test
    public void fetchesReleaseAndUsesEtagCache() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        List<String> sentEtags = new ArrayList<>();
        srv.on("/repos/o/r/releases/latest", ex -> {
            calls.incrementAndGet();
            sentEtags.add(ex.getRequestHeaders().getFirst("If-None-Match"));
            assertEquals("application/vnd.github+json", ex.getRequestHeaders().getFirst("Accept"));
            if ("\"v16\"".equals(ex.getRequestHeaders().getFirst("If-None-Match"))) {
                TestHttps.send(ex, 304, null);
                return;
            }
            ex.getResponseHeaders().add("ETag", "\"v16\"");
            TestHttps.send(ex, 200, releaseJson(srv.base + "/dl/OpenCard.apk").getBytes(StandardCharsets.UTF_8));
        });
        FakePrefs prefs = new FakePrefs();
        GitHubReleaseClient c = new GitHubReleaseClient(cfg, prefs);
        ReleaseInfo a = c.latest(null);
        ReleaseInfo b = c.latest(null); // answered by 304 + cache
        assertEquals("1.0.16", a.version.toString());
        assertEquals("1.0.16", b.version.toString());
        assertEquals(2, calls.get());
        assertEquals(null, sentEtags.get(0));
        assertEquals("\"v16\"", sentEtags.get(1));
    }

    @Test
    public void reportsMissingRepoRateLimitAndServerErrors() throws Exception {
        AtomicInteger mode = new AtomicInteger();
        srv.on("/repos/o/r/releases/latest", ex -> {
            switch (mode.get()) {
                case 0: TestHttps.send(ex, 404, "{}".getBytes()); break;
                case 1:
                    ex.getResponseHeaders().add("X-RateLimit-Remaining", "0");
                    ex.getResponseHeaders().add("X-RateLimit-Reset", "1900000000");
                    TestHttps.send(ex, 403, "{}".getBytes());
                    break;
                case 2:
                    ex.getResponseHeaders().add("Retry-After", "60");
                    TestHttps.send(ex, 429, "{}".getBytes());
                    break;
                default: TestHttps.send(ex, 502, "bad gateway".getBytes());
            }
        });
        GitHubReleaseClient c = new GitHubReleaseClient(cfg, new FakePrefs());
        mode.set(0);
        assertKind(c, UpdateException.Kind.NOT_FOUND);
        mode.set(1);
        UpdateException e = assertKind(c, UpdateException.Kind.RATE_LIMITED);
        assertEquals(1900000000L, e.retryAt);
        mode.set(2);
        e = assertKind(c, UpdateException.Kind.RATE_LIMITED);
        assertTrue(e.retryAt > System.currentTimeMillis() / 1000);
        mode.set(3);
        assertKind(c, UpdateException.Kind.BAD_RESPONSE);
    }

    @Test
    public void unreachableServerIsANetworkError() throws Exception {
        srv.close();
        assertKind(new GitHubReleaseClient(cfg, new FakePrefs()), UpdateException.Kind.NETWORK);
    }

    @Test
    public void readsChecksumAsset() throws Exception {
        srv.on("/dl/OpenCard.apk.sha256", ex -> TestHttps.send(ex, 200, (Checksums.sha256Hex(apk) + "  OpenCard.apk\n").getBytes()));
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        assertEquals(Checksums.sha256Hex(apk), new GitHubReleaseClient(cfg, new FakePrefs()).checksumFromAsset(null, r));
    }

    @Test
    public void downloadsWithRedirectAndProgress() throws Exception {
        srv.on("/dl/OpenCard.apk", ex -> {
            ex.getResponseHeaders().add("Location", srv.base + "/cdn/OpenCard.apk");
            TestHttps.send(ex, 302, null);
        });
        srv.on("/cdn/OpenCard.apk", ex -> TestHttps.send(ex, 200, apk));
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        List<Long> progress = new ArrayList<>();
        File out = new ApkDownloader(cfg).download(null, r, new File(tmp.getRoot(), "u/update-1.0.16.apk"), new AtomicBoolean(), (d, t) -> progress.add(d));
        assertArrayEquals(apk, Files.readAllBytes(out.toPath()));
        assertEquals(Long.valueOf(apk.length), progress.get(progress.size() - 1));
        assertFalse(new File(out.getPath() + ".part").exists());
    }

    @Test
    public void resumesAnInterruptedDownload() throws Exception {
        List<String> ranges = new ArrayList<>();
        srv.on("/dl/OpenCard.apk", ex -> {
            String range = ex.getRequestHeaders().getFirst("Range");
            ranges.add(range);
            int from = Integer.parseInt(range.replaceAll("[^0-9]", ""));
            byte[] rest = java.util.Arrays.copyOfRange(apk, from, apk.length);
            ex.getResponseHeaders().add("Content-Range", "bytes " + from + "-" + (apk.length - 1) + "/" + apk.length);
            TestHttps.send(ex, 206, rest);
        });
        File target = new File(tmp.getRoot(), "update-1.0.16.apk");
        Files.write(new File(target.getPath() + ".part").toPath(), java.util.Arrays.copyOf(apk, 120_000));
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        File out = new ApkDownloader(cfg).download(null, r, target, new AtomicBoolean(), (d, t) -> { });
        assertEquals("bytes=120000-", ranges.get(0));
        assertArrayEquals(apk, Files.readAllBytes(out.toPath()));
    }

    @Test
    public void restartsWhenServerIgnoresRange() throws Exception {
        srv.on("/dl/OpenCard.apk", ex -> TestHttps.send(ex, 200, apk));
        File target = new File(tmp.getRoot(), "update-1.0.16.apk");
        Files.write(new File(target.getPath() + ".part").toPath(), new byte[50_000]); // junk from an old attempt
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        File out = new ApkDownloader(cfg).download(null, r, target, new AtomicBoolean(), (d, t) -> { });
        assertArrayEquals(apk, Files.readAllBytes(out.toPath()));
    }

    @Test
    public void truncatedDownloadIsReportedAndKeptForResume() throws Exception {
        srv.on("/dl/OpenCard.apk", ex -> TestHttps.send(ex, 200, java.util.Arrays.copyOf(apk, 100_000)));
        File target = new File(tmp.getRoot(), "update-1.0.16.apk");
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        try {
            new ApkDownloader(cfg).download(null, r, target, new AtomicBoolean(), (d, t) -> { });
            fail("expected an error");
        } catch (UpdateException e) {
            assertEquals(UpdateException.Kind.NETWORK, e.kind);
        }
        assertFalse(target.exists());
        assertEquals(100_000, new File(target.getPath() + ".part").length());
    }

    @Test
    public void oversizedDownloadIsRejected() throws Exception {
        byte[] big = new byte[apk.length + 1000];
        srv.on("/dl/OpenCard.apk", ex -> TestHttps.send(ex, 200, big));
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        try {
            new ApkDownloader(cfg).download(null, r, new File(tmp.getRoot(), "a.apk"), new AtomicBoolean(), (d, t) -> { });
            fail("expected an error");
        } catch (UpdateException e) {
            assertEquals(UpdateException.Kind.CORRUPT, e.kind);
        }
    }

    @Test
    public void cancelStopsTheDownload() throws Exception {
        srv.on("/dl/OpenCard.apk", ex -> TestHttps.send(ex, 200, apk));
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        AtomicBoolean cancel = new AtomicBoolean(true);
        try {
            new ApkDownloader(cfg).download(null, r, new File(tmp.getRoot(), "a.apk"), cancel, (d, t) -> { });
            fail("expected cancel");
        } catch (UpdateException e) {
            assertEquals(UpdateException.Kind.CANCELLED, e.kind);
        }
    }

    @Test
    public void refusesPlainHttp() throws Exception {
        ReleaseInfo r = ReleaseInfo.parse(releaseJson(srv.base + "/dl/OpenCard.apk"), "OpenCard.apk", "OpenCard.apk.sha256");
        srv.on("/dl/OpenCard.apk", ex -> {
            ex.getResponseHeaders().add("Location", "http://localhost:1/OpenCard.apk");
            TestHttps.send(ex, 302, null);
        });
        try {
            new ApkDownloader(cfg).download(null, r, new File(tmp.getRoot(), "a.apk"), new AtomicBoolean(), (d, t) -> { });
            fail("expected refusal");
        } catch (UpdateException e) {
            assertEquals(UpdateException.Kind.NETWORK, e.kind);
        }
    }

    private static UpdateException assertKind(GitHubReleaseClient c, UpdateException.Kind kind) {
        try {
            c.latest(null);
            fail("expected " + kind);
            return null;
        } catch (UpdateException e) {
            assertEquals(kind, e.kind);
            return e;
        }
    }
}
