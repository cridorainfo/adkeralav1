package com.adkerala.driver;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS bridge to the always-on native tracker (GpsTrackingService). */
@CapacitorPlugin(name = "GpsTracker")
public class GpsTrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String driverId = call.getString("driverId");
        String cloudUrl = call.getString("cloudUrl");
        if (driverId == null || cloudUrl == null) {
            call.reject("Missing driverId or cloudUrl");
            return;
        }

        Context context = getContext();
        boolean fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        if (!fine && !coarse) {
            // Starting a location-type foreground service without this permission already
            // granted crashes the whole app on Android 14+. Fail the call instead so the
            // JS side can request permission first.
            call.reject("Location permission not granted");
            return;
        }

        Intent intent = new Intent(context, GpsTrackingService.class);
        intent.putExtra(GpsTrackingService.KEY_DRIVER_ID, driverId);
        intent.putExtra(GpsTrackingService.KEY_CLOUD_URL, cloudUrl);
        ContextCompat.startForegroundService(context, intent);

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_STOP);
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(GpsTrackingService.PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("tracking", prefs.getBoolean(GpsTrackingService.KEY_TRACKING, false));
        result.put("lastFixAt", prefs.getLong(GpsTrackingService.KEY_LAST_FIX_AT, 0));
        result.put("lastSyncAt", prefs.getLong(GpsTrackingService.KEY_LAST_SYNC_AT, 0));
        result.put("lastError", prefs.getString(GpsTrackingService.KEY_LAST_ERROR, null));
        result.put("pushCount", prefs.getInt(GpsTrackingService.KEY_PUSH_COUNT, 0));

        String lat = prefs.getString(GpsTrackingService.KEY_LAST_LAT, null);
        String lng = prefs.getString(GpsTrackingService.KEY_LAST_LNG, null);
        if (lat != null && lng != null) {
            result.put("lat", Double.parseDouble(lat));
            result.put("lng", Double.parseDouble(lng));
            float accuracy = prefs.getFloat(GpsTrackingService.KEY_LAST_ACCURACY, -1f);
            if (accuracy >= 0) result.put("accuracy", accuracy);
        }

        call.resolve(result);
    }
}
