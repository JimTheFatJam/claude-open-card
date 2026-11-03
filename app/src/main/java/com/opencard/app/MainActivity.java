package com.opencard.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import com.opencard.app.updater.UpdateBridge;
import com.opencard.app.updater.UpdateManager;

/**
 * Open Card hosts the whole game collection (HTML/CSS/JS in assets/www)
 * inside a full-screen WebView. The games run offline; the only network use is the
 * Wi-Fi-only update check (see the updater package).
 */
public class MainActivity extends Activity {

    private WebView webView;
    private OnBackInvokedCallback backCallback;
    private UpdateManager updates;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (BuildConfig.WEB_DEBUG) WebView.setWebContentsDebuggingEnabled(true); // e2e test builds only
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0F5132"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // statistics + settings live in localStorage
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                    // ignore system font scaling so card layouts fit
        s.setMinimumFontSize(1);               // WebView's default 8px minimum would enlarge small card indexes
        s.setMinimumLogicalFontSize(1);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Stay inside the bundled app; never navigate to outside pages.
                return !request.getUrl().toString().startsWith("file:///android_asset/");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // One quiet update check per launch, only on Wi-Fi, after the game has loaded.
                if (url.startsWith("file:///android_asset/")) updates.onAppLaunched();
            }
        });

        updates = UpdateManager.get(this);
        UpdateBridge bridge = new UpdateBridge(webView, updates);
        webView.addJavascriptInterface(bridge, UpdateBridge.JS_NAME);
        updates.attach(this, bridge);

        setContentView(webView);
        hideSystemBars();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl("file:///android_asset/www/index.html");
        }

        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    /** Ask the web app to go back one screen; close the app if it is already on the home screen. */
    private void handleBack() {
        webView.evaluateJavascript(
                "(window.OpenCard && window.OpenCard.back) ? window.OpenCard.back() : false",
                value -> {
                    if (!"true".equals(value)) finish();
                });
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Stop the background music while the app isn't visible.
        webView.evaluateJavascript("window.OpenCard && OpenCard.music && OpenCard.music.appPaused(true)", null);
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        webView.evaluateJavascript("window.OpenCard && OpenCard.music && OpenCard.music.appPaused(false)", null);
        updates.onResume(); // continue an update after the user allowed installs in Settings
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        updates.detach(this);
        webView.destroy();
        super.onDestroy();
    }
}
