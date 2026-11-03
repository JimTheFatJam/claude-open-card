package com.opencard.app.updater;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * Exposes the updater to the game's web UI as window.OCUpdaterNative and pushes state changes
 * to OpenCard.updater._event(...). JavaScript only receives state; it can't choose URLs or files.
 */
public final class UpdateBridge implements UpdateManager.Listener {
    public static final String JS_NAME = "OCUpdaterNative";
    private final WebView web;
    private final UpdateManager mgr;

    public UpdateBridge(WebView web, UpdateManager mgr) {
        this.web = web;
        this.mgr = mgr;
    }

    @Override
    public void onUpdateState(JSONObject state) {
        String js = "window.OpenCard&&OpenCard.updater&&OpenCard.updater._event(" + JSONObject.quote(state.toString()) + ")";
        web.evaluateJavascript(js, null);
    }

    @JavascriptInterface public String getState() { return mgr.snapshot().toString(); }
    @JavascriptInterface public void checkNow() { mgr.checkNow(); }
    @JavascriptInterface public void download() { mgr.download(); }
    @JavascriptInterface public void cancelDownload() { mgr.cancelDownload(); }
    @JavascriptInterface public void install() { web.post(mgr::install); }
    @JavascriptInterface public void later() { mgr.later(); }
    @JavascriptInterface public void skip() { mgr.skip(); }
    @JavascriptInterface public void openInstallSettings() { web.post(mgr::openInstallSettings); }
    @JavascriptInterface public void setAutoCheck(boolean on) { mgr.setAutoCheck(on); }
}
