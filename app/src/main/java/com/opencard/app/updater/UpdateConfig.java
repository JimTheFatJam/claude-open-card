package com.opencard.app.updater;

import com.opencard.app.BuildConfig;

/**
 * Where updates come from. Values are set in gradle.properties (updater.*) and compiled into
 * BuildConfig, so pointing the updater at another repository or asset name needs no code change.
 */
public final class UpdateConfig {
    /** GitHub API root; "https://api.github.com" (or a GitHub Enterprise URL). */
    public final String apiBase;
    public final String owner;
    public final String repo;
    public final String apkAsset;
    public final String checksumAsset;
    /** API path under the repo: "releases/latest" (default) or e.g. "releases/tags/beta" for a channel. */
    public final String releasePath;
    public final String installedVersionName;
    public final long installedVersionCode;

    public UpdateConfig(String owner, String repo, String apkAsset, String installedVersionName, long installedVersionCode) {
        this("https://api.github.com", owner, repo, apkAsset, "releases/latest", installedVersionName, installedVersionCode);
    }

    public UpdateConfig(String apiBase, String owner, String repo, String apkAsset, String installedVersionName, long installedVersionCode) {
        this(apiBase, owner, repo, apkAsset, "releases/latest", installedVersionName, installedVersionCode);
    }

    public UpdateConfig(String apiBase, String owner, String repo, String apkAsset, String releasePath,
                        String installedVersionName, long installedVersionCode) {
        this.releasePath = releasePath == null || releasePath.isEmpty() ? "releases/latest" : releasePath.replaceAll("^/+", "");
        this.apiBase = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
        this.owner = owner;
        this.repo = repo;
        this.apkAsset = apkAsset;
        this.checksumAsset = apkAsset + ".sha256";
        this.installedVersionName = installedVersionName;
        this.installedVersionCode = installedVersionCode;
    }

    public static UpdateConfig fromBuild() {
        return new UpdateConfig("https://api.github.com", BuildConfig.UPDATE_GITHUB_OWNER, BuildConfig.UPDATE_GITHUB_REPO,
                BuildConfig.UPDATE_APK_ASSET, BuildConfig.UPDATE_RELEASE_PATH, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE);
    }

    public boolean enabled() {
        return !owner.isEmpty() && !repo.isEmpty() && !apkAsset.isEmpty();
    }

    public String latestReleaseUrl() {
        return apiBase + "/repos/" + owner + "/" + repo + "/" + releasePath;
    }

    /** The default channel only accepts final releases; an explicit channel/tag may be a pre-release. */
    public boolean allowsPrerelease() {
        return !"releases/latest".equals(releasePath);
    }

    public String userAgent() {
        return repo + "-updater/" + installedVersionName + " (Android)";
    }
}
