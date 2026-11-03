package com.opencard.app.updater;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** SHA-256 helpers. Plain Java so it can be unit-tested on the JVM. */
public final class Checksums {
    private static final Pattern HEX64 = Pattern.compile("(?i)\\b([0-9a-f]{64})\\b");

    private Checksums() {}

    public static String sha256Hex(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            return sha256Hex(in);
        }
    }

    public static String sha256Hex(InputStream in) throws IOException {
        MessageDigest md;
        try {
            md = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IOException("SHA-256 not available", e);
        }
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        return hex(md.digest());
    }

    public static String sha256Hex(byte[] data) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    /** Normalises "sha256:ABC…" (GitHub asset digest) or a bare hex string. Returns null if not a SHA-256. */
    public static String normalize(String s) {
        if (s == null) return null;
        String t = s.trim();
        if (t.toLowerCase(Locale.ROOT).startsWith("sha256:")) t = t.substring(7);
        return t.matches("(?i)[0-9a-f]{64}") ? t.toLowerCase(Locale.ROOT) : null;
    }

    /**
     * Reads a checksum file in "sha256sum" format ("hex  filename" per line) or a bare hex digest.
     * Prefers the line naming {@code assetName}. Returns null if no digest is found.
     */
    public static String fromChecksumFile(String content, String assetName) {
        if (content == null) return null;
        String fallback = null;
        for (String line : content.split("\\r?\\n")) {
            Matcher m = HEX64.matcher(line);
            if (!m.find()) continue;
            String hex = m.group(1).toLowerCase(Locale.ROOT);
            String rest = line.substring(m.end()).trim().replaceFirst("^\\*", "");
            if (assetName != null && rest.equals(assetName)) return hex;
            if (fallback == null && (rest.isEmpty() || assetName == null)) fallback = hex;
        }
        return fallback;
    }

    /** Constant-time comparison of two hex digests. */
    public static boolean matches(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int diff = 0;
        for (int i = 0; i < a.length(); i++) diff |= Character.toLowerCase(a.charAt(i)) ^ Character.toLowerCase(b.charAt(i));
        return diff == 0;
    }
}
