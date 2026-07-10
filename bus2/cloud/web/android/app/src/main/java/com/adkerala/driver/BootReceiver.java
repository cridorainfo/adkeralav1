package com.adkerala.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.content.ContextCompat;

/** Resumes tracking after a phone reboot if the driver was still linked. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        SharedPreferences prefs = context.getSharedPreferences(GpsTrackingService.PREFS, Context.MODE_PRIVATE);
        boolean tracking = prefs.getBoolean(GpsTrackingService.KEY_TRACKING, false);
        if (!tracking) return;

        Intent serviceIntent = new Intent(context, GpsTrackingService.class);
        ContextCompat.startForegroundService(context, serviceIntent);
    }
}
