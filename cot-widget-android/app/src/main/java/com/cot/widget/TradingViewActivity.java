package com.cot.widget;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * TradingView inside the app: its live charts, with the user's own TradingView login.
 * Cookies persist, so the user signs in (or creates an account) once. Nothing opens a browser.
 */
public class TradingViewActivity extends AppCompatActivity {

    private static final String HOME = "https://www.tradingview.com/";
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int bg = Color.parseColor("#060913"), cyan = Color.parseColor("#00E5FF");
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(bg);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(4), 0, dp(8), 0);
        TextView back = button("\u2039  App", cyan);
        back.setOnClickListener(v -> finish());
        TextView title = new TextView(this);
        title.setText("TRADINGVIEW \u00b7 LIVE");
        title.setTextColor(Color.parseColor("#F8FAFC"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        title.setLetterSpacing(0.08f);
        title.setGravity(Gravity.CENTER);
        TextView reload = button("\u21bb", cyan);
        reload.setOnClickListener(v -> web.reload());
        bar.addView(back, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        bar.addView(reload, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));

        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(cyan));
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        web = new WebView(this);
        web.setBackgroundColor(bg);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        setup(this, web, progress);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        String path = getIntent().getStringExtra("path");
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(HOME + (path == null ? "chart/?symbol=OANDA:XAUUSD" : path));
        }
    }

    /** Shared by this screen and the overlay on the Charts tab: settings, cookies, in-app navigation. */
    @SuppressLint("SetJavaScriptEnabled")
    static void setup(Activity act, WebView web, ProgressBar progress) {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                if (progress == null) return;
                progress.setProgress(p);
                progress.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                String host = u.getHost() == null ? "" : u.getHost();
                if (host.endsWith("accounts.google.com") || host.endsWith("appleid.apple.com")) {
                    explainSocialLogin(act, host.contains("google") ? "Google" : "Apple");
                    return true;
                }
                // Everything web stays in this view; app links (intent://, market://) are ignored.
                return !("https".equals(scheme) || "http".equals(scheme));
            }
        });
    }

    // Google and Apple refuse sign-in inside embedded web views, so explain the email route.
    static void explainSocialLogin(Activity act, String who) {
        new AlertDialog.Builder(act)
                .setTitle(who + " sign-in isn't allowed here")
                .setMessage(who + " blocks its sign-in inside apps. On TradingView, choose \"Email\" instead.\n\n"
                        + "If your TradingView account was made with " + who + ", set a password once: on TradingView tap "
                        + "Sign in \u2192 Email \u2192 \"Forgot password?\" and use the same email. After that you stay signed in here.")
                .setPositiveButton("OK", null)
                .show();
    }

    private TextView button(String text, int color) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextColor(color);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(12), 0, dp(12), 0);
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true);
        b.setBackgroundResource(tv.resourceId);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
