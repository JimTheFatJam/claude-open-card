package com.opencard.app.updater;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** The parts of a GitHub release the updater needs. */
public final class ReleaseInfo {
    public final String tag;
    public final Version version;
    public final String title;
    public final String changelog;
    public final String pageUrl;
    public final String apkUrl;
    public final long apkSize;
    /** SHA-256 GitHub computed when the asset was uploaded ("digest" field), or null. */
    public final String apkDigest;
    /** URL of the "<apk>.sha256" asset published by the release workflow, or null. */
    public final String checksumUrl;

    ReleaseInfo(String tag, Version version, String title, String changelog, String pageUrl,
                String apkUrl, long apkSize, String apkDigest, String checksumUrl) {
        this.tag = tag;
        this.version = version;
        this.title = title;
        this.changelog = changelog;
        this.pageUrl = pageUrl;
        this.apkUrl = apkUrl;
        this.apkSize = apkSize;
        this.apkDigest = apkDigest;
        this.checksumUrl = checksumUrl;
    }

    /**
     * Parses the JSON of GET /repos/{owner}/{repo}/releases/latest.
     * @param apkAsset      file name of the APK asset (e.g. "OpenCard.apk")
     * @param checksumAsset file name of the checksum asset (e.g. "OpenCard.apk.sha256")
     */
    public static ReleaseInfo parse(String json, String apkAsset, String checksumAsset) throws UpdateException {
        return parse(json, apkAsset, checksumAsset, false);
    }

    public static ReleaseInfo parse(String json, String apkAsset, String checksumAsset, boolean allowPrerelease) throws UpdateException {
        try {
            JSONObject o = new JSONObject(json);
            if (o.optBoolean("draft") || (o.optBoolean("prerelease") && !allowPrerelease)) {
                throw new UpdateException(UpdateException.Kind.NOT_FOUND, "The latest release is not published yet.");
            }
            String tag = o.optString("tag_name", "");
            Version v = Version.parse(tag);
            if (v == null) v = Version.parse(o.optString("name", ""));
            if (v == null) throw new UpdateException(UpdateException.Kind.BAD_RESPONSE, "The release has no version number.");
            String apkUrl = null, digest = null, sumUrl = null;
            long size = -1;
            JSONArray assets = o.optJSONArray("assets");
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    String name = a.optString("name", "");
                    if (name.equals(apkAsset)) {
                        apkUrl = a.optString("browser_download_url", null);
                        size = a.optLong("size", -1);
                        digest = Checksums.normalize(a.optString("digest", null));
                    } else if (name.equals(checksumAsset)) {
                        sumUrl = a.optString("browser_download_url", null);
                    }
                }
            }
            if (apkUrl == null || !apkUrl.startsWith("https://")) {
                throw new UpdateException(UpdateException.Kind.NO_APK, "The latest release has no " + apkAsset + " file.");
            }
            return new ReleaseInfo(tag, v, o.optString("name", tag), o.optString("body", "").trim(),
                    o.optString("html_url", ""), apkUrl, size, digest, sumUrl);
        } catch (JSONException e) {
            throw new UpdateException(UpdateException.Kind.BAD_RESPONSE, "GitHub sent a response the app couldn't read.", e);
        }
    }
}
