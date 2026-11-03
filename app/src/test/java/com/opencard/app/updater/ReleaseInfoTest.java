package com.opencard.app.updater;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

import org.junit.Test;

public class ReleaseInfoTest {
    static final String DIGEST = "e4de9e45d48e96d3e6b9e7cb0417f24f08f4986ff825ae920a14f87f6b324a6e";

    static String release(String tag, String extraAssets, boolean draft) {
        return "{\"tag_name\":\"" + tag + "\",\"name\":\"Open Card " + tag + "\",\"draft\":" + draft + ",\"prerelease\":false,"
                + "\"html_url\":\"https://github.com/o/r/releases/tag/" + tag + "\",\"body\":\"- New game\\n- Fixes\","
                + "\"assets\":[{\"name\":\"OpenCard.apk\",\"size\":142949,\"digest\":\"sha256:" + DIGEST + "\","
                + "\"browser_download_url\":\"https://github.com/o/r/releases/download/" + tag + "/OpenCard.apk\"}" + extraAssets + "]}";
    }

    @Test
    public void parsesARelease() throws Exception {
        ReleaseInfo r = ReleaseInfo.parse(release("v1.0.16",
                ",{\"name\":\"OpenCard.apk.sha256\",\"size\":80,\"browser_download_url\":\"https://github.com/o/r/releases/download/v1.0.16/OpenCard.apk.sha256\"}", false),
                "OpenCard.apk", "OpenCard.apk.sha256");
        assertEquals("1.0.16", r.version.toString());
        assertEquals(142949, r.apkSize);
        assertEquals(DIGEST, r.apkDigest);
        assertEquals("- New game\n- Fixes", r.changelog);
        assertEquals("https://github.com/o/r/releases/download/v1.0.16/OpenCard.apk.sha256", r.checksumUrl);
    }

    @Test
    public void checksumAssetIsOptional() throws Exception {
        ReleaseInfo r = ReleaseInfo.parse(release("v2.0", "", false), "OpenCard.apk", "OpenCard.apk.sha256");
        assertNull(r.checksumUrl);
        assertEquals(DIGEST, r.apkDigest);
    }

    @Test
    public void preReleasesOnlyOnAnExplicitChannel() throws Exception {
        String pre = release("v3.0", "", false).replace("\"prerelease\":false", "\"prerelease\":true");
        expect(UpdateException.Kind.NOT_FOUND, pre, "OpenCard.apk");
        assertEquals("3.0", ReleaseInfo.parse(pre, "OpenCard.apk", "OpenCard.apk.sha256", true).version.toString());
        UpdateConfig latest = new UpdateConfig("o", "r", "OpenCard.apk", "1.0", 1);
        UpdateConfig beta = new UpdateConfig("https://api.github.com/", "o", "r", "OpenCard.apk", "/releases/tags/beta", "1.0", 1);
        assertEquals("https://api.github.com/repos/o/r/releases/latest", latest.latestReleaseUrl());
        assertEquals("https://api.github.com/repos/o/r/releases/tags/beta", beta.latestReleaseUrl());
        assertEquals(false, latest.allowsPrerelease());
        assertEquals(true, beta.allowsPrerelease());
        assertEquals("OpenCard.apk.sha256", beta.checksumAsset);
    }

    @Test
    public void rejectsBadReleases() {
        expect(UpdateException.Kind.NO_APK, release("v1.0.16", "", false), "Other.apk");
        expect(UpdateException.Kind.NOT_FOUND, release("v1.0.16", "", true), "OpenCard.apk");
        expect(UpdateException.Kind.BAD_RESPONSE, "{not json", "OpenCard.apk");
        expect(UpdateException.Kind.BAD_RESPONSE, "{\"tag_name\":\"latest\",\"name\":\"latest\",\"assets\":[]}", "OpenCard.apk");
        expect(UpdateException.Kind.NO_APK, release("v1.0.16", "", false).replace("https://github.com/o/r/releases/download/v1.0.16/OpenCard.apk", "http://evil/OpenCard.apk"), "OpenCard.apk");
    }

    private static void expect(UpdateException.Kind kind, String json, String asset) {
        try {
            ReleaseInfo.parse(json, asset, asset + ".sha256");
            fail("expected " + kind);
        } catch (UpdateException e) {
            assertEquals(kind, e.kind);
        }
    }
}
