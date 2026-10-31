package com.cot.widget;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/** Checks every market a few times a day while the app is closed. */
public class VerdictWorker extends Worker {

    private static final String NAME = "verdict-check";

    public VerdictWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        if (!AlertCenter.backgroundOn(ctx)) return Result.success();
        JSONObject current = MarketScanner.scanAll();
        if (current.length() == 0) return Result.retry();
        AlertCenter.process(ctx, current);
        return Result.success();
    }

    static void sync(Context ctx) {
        WorkManager wm = WorkManager.getInstance(ctx.getApplicationContext());
        if (!AlertCenter.backgroundOn(ctx)) {
            wm.cancelUniqueWork(NAME);
            return;
        }
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(VerdictWorker.class, 3, TimeUnit.HOURS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req);
    }
}
