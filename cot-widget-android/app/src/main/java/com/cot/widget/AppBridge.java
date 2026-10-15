package com.cot.widget;

import android.content.Context;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

/** Exposed to the app's own pages as window.AppBridge. Only local asset pages are ever loaded. */
final class AppBridge {

    interface Host {
        void requestNotificationPermission();

        void openMt5();
    }

    private final Context ctx;
    private final Host host;

    AppBridge(Context ctx, Host host) {
        this.ctx = ctx.getApplicationContext();
        this.host = host;
    }

    @JavascriptInterface
    public String reportVerdicts(String json) {
        try {
            return AlertCenter.process(ctx, new JSONObject(json)).toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    @JavascriptInterface
    public String getAlerts() {
        return AlertCenter.prefs(ctx).getString("log", "[]");
    }

    @JavascriptInterface
    public void clearAlerts() {
        AlertCenter.prefs(ctx).edit().putString("log", "[]").apply();
    }

    @JavascriptInterface
    public String getPrefs() {
        try {
            return new JSONObject()
                    .put("notify", AlertCenter.notifyOn(ctx))
                    .put("background", AlertCenter.backgroundOn(ctx))
                    .put("muted", AlertCenter.muted(ctx))
                    .put("permission", AlertCenter.canPost(ctx))
                    .toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void setPref(String key, String value) {
        switch (key) {
            case "notify":
            case "background":
                AlertCenter.prefs(ctx).edit().putBoolean(key, Boolean.parseBoolean(value)).apply();
                if ("background".equals(key)) VerdictWorker.sync(ctx);
                break;
            case "muted":
                try {
                    AlertCenter.prefs(ctx).edit().putString("muted", new JSONArray(value).toString()).apply();
                } catch (Exception ignored) {
                }
                break;
            default:
                break;
        }
    }

    @JavascriptInterface
    public boolean notificationsAllowed() {
        return AlertCenter.canPost(ctx);
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        host.requestNotificationPermission();
    }

    /** Posts a chart BUY / SELL signal as a high-priority notification right away. */
    @JavascriptInterface
    public void notifySignal(String title, String body) {
        AlertCenter.notifySignal(ctx, title, body);
    }

    /** Opens MetaTrader 5 (used by XM and Octa accounts), or its Play Store page if it is not installed. */
    @JavascriptInterface
    public void openMt5() {
        host.openMt5();
    }

    @JavascriptInterface
    public void notifyNews(String title, String body) {
        AlertCenter.notifyNews(ctx, title, body, (int) (System.currentTimeMillis() & 0x7fffffff));
    }

    /** @param json [{id, at (epoch ms), title, body}] — replaces all pending reminders */
    @JavascriptInterface
    public void scheduleNewsReminders(String json) {
        NewsReminderWorker.schedule(ctx, json);
    }
}
