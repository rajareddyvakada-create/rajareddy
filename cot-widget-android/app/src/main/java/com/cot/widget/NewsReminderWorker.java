package com.cot.widget;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/** Posts a "big release in 15 minutes" notification, even when the app is closed. */
public class NewsReminderWorker extends Worker {

    private static final String TAG = "news-reminder";

    public NewsReminderWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Data d = getInputData();
        long at = d.getLong("at", 0);
        // Skip reminders that fire long after the event (phone was off or in deep sleep).
        if (at > 0 && System.currentTimeMillis() - at > 20 * 60 * 1000L) return Result.success();
        AlertCenter.notifyNews(getApplicationContext(), d.getString("title"), d.getString("body"),
                ("rem" + d.getString("id")).hashCode());
        return Result.success();
    }

    static void schedule(Context ctx, String json) {
        WorkManager wm = WorkManager.getInstance(ctx.getApplicationContext());
        wm.cancelAllWorkByTag(TAG);
        try {
            JSONArray list = new JSONArray(json);
            long now = System.currentTimeMillis();
            for (int i = 0; i < list.length() && i < 40; i++) {
                JSONObject e = list.getJSONObject(i);
                long at = e.getLong("at");
                if (at <= now) continue;
                Data data = new Data.Builder()
                        .putString("id", e.optString("id"))
                        .putString("title", e.optString("title"))
                        .putString("body", e.optString("body"))
                        .putLong("at", at)
                        .build();
                wm.enqueue(new OneTimeWorkRequest.Builder(NewsReminderWorker.class)
                        .setInitialDelay(at - now, TimeUnit.MILLISECONDS)
                        .setInputData(data)
                        .addTag(TAG)
                        .build());
            }
        } catch (Exception ignored) {
            // A malformed list leaves no reminders; the next calendar refresh sends a new one.
        }
    }
}
