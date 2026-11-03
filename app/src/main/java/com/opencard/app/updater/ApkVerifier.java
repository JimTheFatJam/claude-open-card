package com.opencard.app.updater;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;

/**
 * Checks a downloaded APK before it is handed to Android's installer:
 * SHA-256 checksum, package name, newer version, device compatibility, and that it is signed
 * with the same developer certificate as the installed app. (Android repeats the signature
 * check itself during installation; checking here lets us explain problems clearly.)
 */
public final class ApkVerifier {
    public static final class Result {
        public final String versionName;
        public final long versionCode;

        Result(String versionName, long versionCode) {
            this.versionName = versionName;
            this.versionCode = versionCode;
        }
    }

    private ApkVerifier() {}

    public static Result verify(Context ctx, File apk, String expectedSha256) throws UpdateException {
        // 1. integrity
        if (expectedSha256 == null) throw new UpdateException(UpdateException.Kind.CHECKSUM_MISSING, "The release has no checksum, so the download can't be verified.");
        String actual;
        try {
            actual = Checksums.sha256Hex(apk);
        } catch (IOException e) {
            throw new UpdateException(UpdateException.Kind.STORAGE, "Couldn't read the downloaded file.", e);
        }
        if (!Checksums.matches(actual, expectedSha256)) {
            throw new UpdateException(UpdateException.Kind.CHECKSUM_MISMATCH, "The download is damaged (checksum doesn't match).");
        }

        // 2. it's a valid APK for this app
        PackageManager pm = ctx.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : signaturesFlag();
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getPath(), flags);
        if (archive == null) throw new UpdateException(UpdateException.Kind.CORRUPT, "The downloaded file isn't a valid Android app.");
        if (!ctx.getPackageName().equals(archive.packageName)) {
            throw new UpdateException(UpdateException.Kind.WRONG_PACKAGE, "The download is a different app (" + archive.packageName + ").");
        }
        PackageInfo installed;
        try {
            installed = pm.getPackageInfo(ctx.getPackageName(), flags);
        } catch (PackageManager.NameNotFoundException e) {
            throw new UpdateException(UpdateException.Kind.INSTALL_FAILED, "Couldn't read the installed app.", e);
        }
        long newCode = versionCode(archive);
        if (newCode <= versionCode(installed)) {
            throw new UpdateException(UpdateException.Kind.NOT_NEWER, "The download isn't newer than the installed version.");
        }
        ApplicationInfo ai = archive.applicationInfo;
        if (ai != null && ai.minSdkVersion > Build.VERSION.SDK_INT) {
            throw new UpdateException(UpdateException.Kind.INCOMPATIBLE, "This update needs a newer version of Android.");
        }

        // 3. same developer signing certificate
        if (!sameSigner(archive, installed)) {
            throw new UpdateException(UpdateException.Kind.SIGNATURE_MISMATCH, "The update isn't signed by the same developer key as the installed app.");
        }
        return new Result(archive.versionName, newCode);
    }

    @SuppressWarnings("deprecation")
    private static int signaturesFlag() {
        return PackageManager.GET_SIGNATURES;
    }

    @SuppressWarnings("deprecation")
    static long versionCode(PackageInfo p) {
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    /** SHA-256 fingerprints of the signing certificates, and whether the APK has several signers. */
    @SuppressWarnings("deprecation")
    static Set<String> certs(PackageInfo p, boolean[] multiple) {
        Signature[] sigs = null;
        multiple[0] = false;
        if (Build.VERSION.SDK_INT >= 28 && p.signingInfo != null) {
            SigningInfo si = p.signingInfo;
            multiple[0] = si.hasMultipleSigners();
            sigs = multiple[0] ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
        } else if (p.signatures != null) {
            sigs = p.signatures;
            multiple[0] = sigs.length > 1;
        }
        Set<String> out = new HashSet<>();
        if (sigs != null) for (Signature s : sigs) out.add(Checksums.sha256Hex(s.toByteArray()));
        return out;
    }

    static boolean sameSigner(PackageInfo archive, PackageInfo installed) {
        boolean[] ma = new boolean[1], mi = new boolean[1];
        Set<String> a = certs(archive, ma);
        Set<String> b = certs(installed, mi);
        if (a.isEmpty() || b.isEmpty()) return false;
        if (ma[0] || mi[0]) return a.equals(b); // several signers: all must match
        // one signer (possibly with a rotation history): the certificates must overlap
        for (String x : a) if (b.contains(x)) return true;
        return false;
    }
}
