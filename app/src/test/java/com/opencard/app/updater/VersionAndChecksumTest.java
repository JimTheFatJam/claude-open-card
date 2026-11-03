package com.opencard.app.updater;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

public class VersionAndChecksumTest {
    @Test
    public void comparesVersionsNumerically() {
        assertTrue(Version.parse("v1.0.16").isNewerThan(Version.parse("1.0.15")));
        assertTrue(Version.parse("1.0.10").isNewerThan(Version.parse("1.0.9")));
        assertTrue(Version.parse("2.0").isNewerThan(Version.parse("1.99.99")));
        assertFalse(Version.parse("1.0.15").isNewerThan(Version.parse("v1.0.15")));
        assertFalse(Version.parse("1.0.14").isNewerThan(Version.parse("1.0.15")));
        assertEquals(Version.parse("1.0"), Version.parse("1.0.0"));
        assertEquals(Version.parse("1.0").hashCode(), Version.parse("1.0.0").hashCode());
        assertEquals("1.2.3", Version.parse("Open Card v1.2.3 (beta)").toString());
        assertTrue(Version.parse("1.0.1").isNewerThan(null));
    }

    @Test
    public void rejectsTextWithoutAVersion() {
        assertNull(Version.parse(null));
        assertNull(Version.parse("latest"));
        assertNull(Version.parse("v99999999999999999999"));
    }

    @Test
    public void sha256KnownVector() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                Checksums.sha256Hex("abc".getBytes(StandardCharsets.US_ASCII)));
    }

    @Test
    public void normalizesDigests() {
        String hex = "e4de9e45d48e96d3e6b9e7cb0417f24f08f4986ff825ae920a14f87f6b324a6e";
        assertEquals(hex, Checksums.normalize("sha256:" + hex));
        assertEquals(hex, Checksums.normalize(hex.toUpperCase()));
        assertNull(Checksums.normalize("sha1:abc"));
        assertNull(Checksums.normalize("sha256:" + hex.substring(1)));
        assertNull(Checksums.normalize(null));
    }

    @Test
    public void readsChecksumFiles() {
        String a = "e4de9e45d48e96d3e6b9e7cb0417f24f08f4986ff825ae920a14f87f6b324a6e";
        String b = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assertEquals(a, Checksums.fromChecksumFile(a + "  OpenCard.apk\n", "OpenCard.apk"));
        assertEquals(a, Checksums.fromChecksumFile(a + " *OpenCard.apk", "OpenCard.apk"));
        assertEquals(a, Checksums.fromChecksumFile(a + "\n", "OpenCard.apk"));
        assertEquals(b, Checksums.fromChecksumFile(a + "  Other.apk\n" + b + "  OpenCard.apk\n", "OpenCard.apk"));
        assertNull(Checksums.fromChecksumFile(a + "  Other.apk\n", "OpenCard.apk"));
        assertNull(Checksums.fromChecksumFile("not a checksum", "OpenCard.apk"));
    }

    @Test
    public void comparesDigestsSafely() {
        assertTrue(Checksums.matches("abcd", "ABCD"));
        assertFalse(Checksums.matches("abcd", "abce"));
        assertFalse(Checksums.matches("abcd", null));
        assertFalse(Checksums.matches("abc", "abcd"));
    }
}
