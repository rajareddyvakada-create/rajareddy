package com.cot.widget;

import android.Manifest;
import android.accounts.Account;
import android.accounts.AccountManager;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends AppCompatActivity implements AppBridge.Host {

    private static final String APP_URL = "file:///android_asset/index.html";
    private static final int REQ_NOTIFY = 7;
    private WebView webView;
    private String pendingTab;
    private ActivityResultLauncher<Intent> accountPicker;
    private FrameLayout root;
    private WebView tvView;
    private WebView mt5View;
    private String tvUrl;
    private long lastChartCrash;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The Midnight Cyberpunk theme is dark in both system modes.
        int bg = Color.parseColor("#060913");

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(bg);
        WindowInsetsControllerCompat bars =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        root = new FrameLayout(this);
        root.setBackgroundColor(bg);
        webView = new WebView(this);
        webView.setBackgroundColor(bg);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Keep page content clear of the status bar, navigation bar and camera cutout.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new AppBridge(this, this), "AppBridge");
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (pendingTab != null && url != null && url.endsWith("index.html")) {
                    openTab(pendingTab);
                    pendingTab = null;
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recreate();
                return true;
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView chart = tvView != null && tvView.getVisibility() == View.VISIBLE ? tvView
                        : mt5View != null && mt5View.getVisibility() == View.VISIBLE ? mt5View : null;
                String home = chart == tvView ? "/chart" : "/terminal";
                if (chart != null && chart.canGoBack() && chart.getUrl() != null && !chart.getUrl().contains(home)) {
                    chart.goBack();
                    return;
                }
                webView.evaluateJavascript("window.appBack ? window.appBack() : false", value -> {
                    if (!"true".equals(value)) {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                });
            }
        });

        accountPicker = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            Intent data = result.getData();
            String email = data == null ? null : data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
            if (email != null) {
                getSharedPreferences("cot_account", MODE_PRIVATE).edit().putString("email", email).apply();
            }
            if (webView != null) {
                String json = new AppBridge(this, this).getAccount();
                webView.evaluateJavascript("window.onAccount && window.onAccount(" + json + ")", null);
            }
        });

        pendingTab = getIntent().getStringExtra("openTab");
        AlertCenter.ensureChannel(this);
        VerdictWorker.sync(this);

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String tab = intent.getStringExtra("openTab");
        if (tab != null) openTab(tab);
    }

    private void openTab(String tab) {
        if (webView == null || !tab.matches("[a-z]+")) return;
        webView.evaluateJavascript("window.appOpenTab && window.appOpenTab('" + tab + "')", null);
    }

    @Override
    public void openMt5() {
        runOnUiThread(() -> {
            Intent launch = getPackageManager().getLaunchIntentForPackage("net.metaquotes.metatrader5");
            try {
                if (launch != null) {
                    startActivity(launch);
                } else {
                    startActivity(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://play.google.com/store/apps/details?id=net.metaquotes.metatrader5")));
                }
            } catch (Exception ignored) {
            }
        });
    }

    @Override
    public void signIn() {
        runOnUiThread(() -> {
            String current = getSharedPreferences("cot_account", MODE_PRIVATE).getString("email", null);
            Account selected = current == null ? null : new Account(current, "com.google");
            Intent pick;
            if (Build.VERSION.SDK_INT >= 26) {
                pick = AccountManager.newChooseAccountIntent(selected, null, new String[]{"com.google"},
                        "Sign in to COT Sentiment", null, null, null);
            } else {
                pick = AccountManager.newChooseAccountIntent(selected, null, new String[]{"com.google"},
                        true, "Sign in to COT Sentiment", null, null, null);
            }
            try {
                accountPicker.launch(pick);
            } catch (Exception e) {
                webView.evaluateJavascript("window.onAccount && window.onAccount(null)", null);
            }
        });
    }

    /** Lays the user's live chart (TradingView, or their XM account in the MT5 web terminal) exactly over
     *  the Charts tab's chart area (rect in CSS pixels). Each service keeps its own view so both stay signed in. */
    @Override
    public void tvShow(int x, int y, int w, int h, String url) {
        runOnUiThread(() -> {
            boolean mt5 = url != null && url.startsWith("https://web.metatrader.app/");
            if (mt5 && mt5View == null) mt5View = newChartView();
            if (!mt5 && tvView == null) tvView = newChartView();
            WebView show = mt5 ? mt5View : tvView;
            WebView other = mt5 ? tvView : mt5View;
            if (other != null) other.setVisibility(View.GONE);
            float d = getResources().getDisplayMetrics().density;
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.round(w * d), Math.round(h * d));
            lp.leftMargin = Math.round(x * d);
            lp.topMargin = Math.round(y * d);
            show.setLayoutParams(lp);
            if (mt5) {
                if (show.getUrl() == null) show.loadUrl(url);
            } else if (url != null && url.startsWith("https://") && !url.equals(tvUrl)) {
                tvUrl = url;
                show.loadUrl(url);
            }
            show.onResume();
            show.setVisibility(View.VISIBLE);
        });
    }

    private WebView newChartView() {
        WebView v = new WebView(this);
        v.setBackgroundColor(Color.parseColor("#060913"));
        TradingViewActivity.setup(this, v, null);
        root.addView(v);
        return v;
    }

    @Override
    public void tvHide() {
        runOnUiThread(() -> {
            if (tvView != null) { tvView.setVisibility(View.GONE); tvView.onPause(); }
            if (mt5View != null) { mt5View.setVisibility(View.GONE); mt5View.onPause(); }
        });
    }

    /** A TradingView / XM page crashed and was removed. Re-open it once; if it crashes again
     *  within a minute, leave the app's own chart showing (tap TV to try again). */
    void chartViewGone(WebView v) {
        if (v == tvView) { tvView = null; tvUrl = null; }
        if (v == mt5View) mt5View = null;
        long now = System.currentTimeMillis();
        boolean retry = now - lastChartCrash > 60_000;
        lastChartCrash = now;
        if (retry && webView != null) webView.postDelayed(() -> {
            if (webView != null) webView.evaluateJavascript("(function(f){f&&f.contentWindow.postMessage({type:'tvRefresh'},'*')})(document.querySelector('#viewCharts iframe'))", null);
        }, 800);
    }

    @Override
    public void openTradingView(String path) {
        runOnUiThread(() -> startActivity(new Intent(this, TradingViewActivity.class).putExtra("path", path)));
    }

    @Override
    public void setLandscape(boolean on) {
        runOnUiThread(() -> {
            setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            WindowInsetsControllerCompat bars =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (on) {
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                bars.show(WindowInsetsCompat.Type.systemBars());
            }
        });
    }

    @Override
    public void requestNotificationPermission() {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 33 && !AlertCenter.canPost(this)) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
            } else {
                reportPermission();
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFY) reportPermission();
    }

    private void reportPermission() {
        if (webView != null) {
            webView.evaluateJavascript("window.onNotifPermission && window.onNotifPermission(" + AlertCenter.canPost(this) + ")", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        if (tvView != null && tvView.getVisibility() == View.VISIBLE) tvView.onResume();
        if (mt5View != null && mt5View.getVisibility() == View.VISIBLE) mt5View.onResume();
    }

    @Override
    protected void onPause() {
        android.webkit.CookieManager.getInstance().flush();
        webView.onPause();
        if (tvView != null) tvView.onPause();
        if (mt5View != null) mt5View.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (tvView != null) { tvView.destroy(); tvView = null; }
        if (mt5View != null) { mt5View.destroy(); mt5View = null; }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
