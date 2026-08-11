package com.adkerala.gpstest;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** JS bridge to GpsTestService. checkPermissions()/requestPermissions() are auto-implemented by
 * the Capacitor Plugin base class from the @Permission below — no need to hand-write them. */
@CapacitorPlugin(
    name = "GpsTest",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        )
    }
)
public class GpsTestPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission not granted");
            return;
        }

        String stopsJson = call.getString("stops");
        if (stopsJson == null) {
            call.reject("Missing stops");
            return;
        }

        Context context = getContext();
        Intent intent = new Intent(context, GpsTestService.class);
        intent.putExtra(GpsTestService.KEY_ROUTE_ID, call.getString("routeId"));
        intent.putExtra(GpsTestService.KEY_ROUTE_NAME, call.getString("routeName"));
        intent.putExtra(GpsTestService.KEY_DIRECTION, call.getString("direction"));
        intent.putExtra(GpsTestService.KEY_CLOUD_URL, call.getString("cloudUrl"));
        intent.putExtra(GpsTestService.KEY_STOPS_JSON, stopsJson);
        ContextCompat.startForegroundService(context, intent);

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, GpsTestService.class);
        intent.setAction(GpsTestService.ACTION_STOP);
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(GpsTestService.PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("running", prefs.getBoolean(GpsTestService.KEY_RUNNING, false));
        result.put("phase", prefs.getString(GpsTestService.KEY_PHASE, "idle"));
        result.put("detail", prefs.getString(GpsTestService.KEY_DETAIL, null));
        result.put("lastFixAt", prefs.getLong(GpsTestService.KEY_LAST_FIX_AT, 0));
        float accuracy = prefs.getFloat(GpsTestService.KEY_LAST_ACCURACY, -1f);
        if (accuracy >= 0) result.put("accuracy", accuracy);
        result.put("pushCount", prefs.getInt(GpsTestService.KEY_PUSH_COUNT, 0));
        call.resolve(result);
    }

    @PluginMethod
    public void getEvents(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(GpsTestService.PREFS, Context.MODE_PRIVATE);
        JSObject result = new JSObject();
        result.put("events", prefs.getString(GpsTestService.KEY_EVENTS_JSON, "[]"));
        call.resolve(result);
    }
}
