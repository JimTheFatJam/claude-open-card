package com.opencard.app.updater;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Numeric dotted versions such as "1.0.16" or release tags such as "v1.0.16".
 * Plain Java (no Android types) so it can be unit-tested on the JVM.
 */
public final class Version implements Comparable<Version> {
    /** A dotted number such as 1.0 or 1.0.16 (needs at least one dot). */
    private static final Pattern DOTTED = Pattern.compile("\\d+(?:\\.\\d+)+");
    /** A whole tag that is just a number, optionally with a leading v: "3", "v3". */
    private static final Pattern BARE = Pattern.compile("^\\s*[vV]?(\\d+)\\s*$");
    private final int[] parts;
    private final String text;

    private Version(int[] parts, String text) {
        this.parts = parts;
        this.text = text;
    }

    /**
     * Parses a version from a tag or title: the first dotted number that starts a word
     * ("v1.2.3", "Open Card 1.2.3", "release-2.1"), or a tag that is only a number ("v3").
     * Digits inside words (like the 2 in "e2e") are ignored. Returns null if there is no version.
     */
    public static Version parse(String s) {
        if (s == null) return null;
        String found = null;
        Matcher m = DOTTED.matcher(s);
        while (m.find()) {
            int i = m.start();
            if (i > 0 && (s.charAt(i - 1) == 'v' || s.charAt(i - 1) == 'V')) i--; // allow a "v" prefix
            if (i == 0 || !Character.isLetterOrDigit(s.charAt(i - 1))) {
                found = m.group();
                break;
            }
        }
        if (found == null) {
            Matcher b = BARE.matcher(s);
            if (!b.matches()) return null;
            found = b.group(1);
        }
        String[] bits = found.split("\\.");
        List<Integer> nums = new ArrayList<>();
        for (String b : bits) {
            try {
                nums.add(Integer.parseInt(b));
            } catch (NumberFormatException e) {
                return null; // absurdly long number
            }
        }
        int[] out = new int[nums.size()];
        for (int i = 0; i < out.length; i++) out[i] = nums.get(i);
        return new Version(out, found);
    }

    @Override
    public int compareTo(Version o) {
        int n = Math.max(parts.length, o.parts.length);
        for (int i = 0; i < n; i++) {
            int a = i < parts.length ? parts[i] : 0;
            int b = i < o.parts.length ? o.parts[i] : 0;
            if (a != b) return a < b ? -1 : 1;
        }
        return 0;
    }

    public boolean isNewerThan(Version o) {
        return o == null || compareTo(o) > 0;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Version && compareTo((Version) o) == 0;
    }

    @Override
    public int hashCode() {
        int h = 0;
        int last = parts.length;
        while (last > 0 && parts[last - 1] == 0) last--; // 1.0 == 1.0.0
        for (int i = 0; i < last; i++) h = h * 31 + parts[i];
        return h;
    }

    @Override
    public String toString() {
        return text;
    }
}
