package com.cot.widget;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * Remembers each market's last verdict, logs changes and posts notifications.
 * Both the open app (through AppBridge) and the background worker report here,
 * so a change is announced once whichever one sees it first.
 */
final class AlertCenter {

    static final String CHANNEL = "verdict_changes";
    private static final String PREFS = "cot_alerts";
    private static final int MAX_LOG = 100;

    private AlertCenter() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean notifyOn(Context c) {
        return prefs(c).getBoolean("notify", true);
    }

    static boolean backgroundOn(Context c) {
        return prefs(c).getBoolean("background", true);
    }

    static JSONArray muted(Context c) {
        try {
            return new JSONArray(prefs(c).getString("muted", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static boolean canPost(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c,
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    /**
     * @param current {ticker: {name, verdict, score, price}}
     * @return the changes found, newest first
     */
    static synchronized JSONArray process(Context ctx, JSONObject current) {
        JSONArray changes = new JSONArray();
        try {
            SharedPreferences p = prefs(ctx);
            JSONObject known = new JSONObject(p.getString("verdicts", "{}"));
            JSONArray log = new JSONArray(p.getString("log", "[]"));
            long now = System.currentTimeMillis();
            Iterator<String> keys = current.keys();
            while (keys.hasNext()) {
                String t = keys.next();
                JSONObject cur = current.getJSONObject(t);
                String verdict = cur.getString("verdict");
                JSONObject prev = known.optJSONObject(t);
                if (prev != null && !verdict.equals(prev.optString("verdict"))) {
                    changes.put(new JSONObject()
                            .put("time", now)
                            .put("ticker", t)
                            .put("name", cur.optString("name", t))
                            .put("from", prev.optString("verdict"))
                            .put("to", verdict)
                            .put("score", cur.optInt("score"))
                            .put("price", cur.optDouble("price", 0)));
                }
                known.put(t, new JSONObject().put("verdict", verdict).put("score", cur.optInt("score")));
            }
            JSONArray merged = new JSONArray();
            for (int i = 0; i < changes.length(); i++) merged.put(changes.get(i));
            for (int i = 0; i < log.length() && merged.length() < MAX_LOG; i++) merged.put(log.get(i));
            p.edit().putString("verdicts", known.toString()).putString("log", merged.toString()).apply();
            if (changes.length() > 0) notifyChanges(ctx, changes);
        } catch (Exception ignored) {
            // A malformed report is dropped; the next report rebuilds the state.
        }
        return changes;
    }

    private static void notifyChanges(Context ctx, JSONArray changes) throws Exception {
        if (!notifyOn(ctx) || !canPost(ctx)) return;
        ensureChannel(ctx);
        JSONArray muted = muted(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("openTab", "alerts");
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        for (int i = 0; i < changes.length(); i++) {
            JSONObject c = changes.getJSONObject(i);
            String ticker = c.getString("ticker");
            boolean skip = false;
            for (int m = 0; m < muted.length(); m++) if (ticker.equals(muted.optString(m))) skip = true;
            if (skip) continue;
            int score = c.optInt("score");
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_alert)
                    .setContentTitle(c.getString("name") + ": " + c.getString("to"))
                    .setContentText("Was " + c.getString("from") + ". Score " + (score > 0 ? "+" : "") + score + ".")
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setContentIntent(pi)
                    .setAutoCancel(true);
            try {
                nm.notify(ticker.hashCode(), b.build());
            } catch (SecurityException ignored) {
                return;
            }
        }
    }

    static final String SIGNALS = "chart_signals";

    static void notifySignal(Context ctx, String title, String body) {
        if (!canPost(ctx)) return;
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("openTab", "charts");
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, SIGNALS)
                .setSmallIcon(R.drawable.ic_stat_alert)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setContentIntent(pi)
                .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify((int) (System.currentTimeMillis() & 0x7fffffff), b.build());
        } catch (SecurityException ignored) {
        }
    }

    static final String NEWS = "news_alerts";

    /** Breaking gold news and pre-event reminders; tapping opens the News tab. */
    static void notifyNews(Context ctx, String title, String body, int id) {
        if (!canPost(ctx)) return;
        ensureChannel(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("openTab", "news");
        PendingIntent pi = PendingIntent.getActivity(ctx, 2, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, NEWS)
                .setSmallIcon(R.drawable.ic_stat_alert)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
                .setContentIntent(pi)
                .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
        }
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Verdict changes",
                    NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("When a market's sentiment verdict changes");
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(SIGNALS) == null) {
            NotificationChannel sc = new NotificationChannel(SIGNALS, "Chart signals",
                    NotificationManager.IMPORTANCE_HIGH);
            sc.setDescription("BUY / SELL signals from the Charts tab, the moment a candle closes");
            nm.createNotificationChannel(sc);
        }
        if (nm.getNotificationChannel(NEWS) == null) {
            NotificationChannel nc = new NotificationChannel(NEWS, "Gold news",
                    NotificationManager.IMPORTANCE_HIGH);
            nc.setDescription("High-impact gold headlines and reminders before big economic releases");
            nm.createNotificationChannel(nc);
        }
    }
}
