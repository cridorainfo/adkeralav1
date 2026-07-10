package com.adkerala.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Runs GPS + cloud upload independently of the WebView/Activity, so tracking survives
 * the app being backgrounded, switched away from, or fully closed — as long as the
 * process isn't killed outright (the foreground service + persisted state protect
 * against that; a null-intent restart from START_STICKY resumes from SharedPreferences).
 */
public class GpsTrackingService extends Service {
    public static final String PREFS = "adkerala_gps_tracker";
    public static final String KEY_TRACKING = "tracking";
    public static final String KEY_DRIVER_ID = "driverId";
    public static final String KEY_CLOUD_URL = "cloudUrl";
    public static final String KEY_LAST_FIX_AT = "lastFixAt";
    public static final String KEY_LAST_SYNC_AT = "lastSyncAt";
    public static final String KEY_LAST_ERROR = "lastError";
    public static final String KEY_LAST_LAT = "lastLat";
    public static final String KEY_LAST_LNG = "lastLng";
    public static final String KEY_LAST_ACCURACY = "lastAccuracy";
    public static final String KEY_PUSH_COUNT = "pushCount";
    public static final String ACTION_STOP = "com.adkerala.driver.ACTION_STOP_TRACKING";

    private static final String TAG = "GpsTrackingService";
    private static final String CHANNEL_ID = "adkerala_gps";
    private static final int NOTIFICATION_ID = 1001;
    private static final long INTERVAL_MS = 5000;
    private static final long MIN_UPDATE_INTERVAL_MS = 3000;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private ExecutorService networkExecutor;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        networkExecutor = Executors.newSingleThreadExecutor();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            prefs.edit().putBoolean(KEY_TRACKING, false).apply();
            stopLocationUpdates();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent != null && intent.hasExtra(KEY_DRIVER_ID)) {
            prefs.edit()
                .putString(KEY_DRIVER_ID, intent.getStringExtra(KEY_DRIVER_ID))
                .putString(KEY_CLOUD_URL, intent.getStringExtra(KEY_CLOUD_URL))
                .putBoolean(KEY_TRACKING, true)
                .putInt(KEY_PUSH_COUNT, 0)
                .remove(KEY_LAST_ERROR)
                .apply();
        }

        String driverId = prefs.getString(KEY_DRIVER_ID, null);
        String cloudUrl = prefs.getString(KEY_CLOUD_URL, null);
        boolean tracking = prefs.getBoolean(KEY_TRACKING, false);

        if (!tracking || driverId == null || cloudUrl == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundCompat();
        startLocationUpdates(driverId, cloudUrl);
        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "GPS tracking", NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Keeps live location active for the fleet map");
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void startForegroundCompat() {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AdKerala Driver")
            .setContentText("Live GPS tracking active")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startLocationUpdates(String driverId, String cloudUrl) {
        if (locationCallback != null) return; // already running

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) onFix(loc, driverId, cloudUrl);
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Missing location permission", e);
            stopSelf();
        }
    }

    private void stopLocationUpdates() {
        if (locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
    }

    private void onFix(Location loc, String driverId, String cloudUrl) {
        long now = System.currentTimeMillis();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putLong(KEY_LAST_FIX_AT, now)
            .putString(KEY_LAST_LAT, String.valueOf(loc.getLatitude()))
            .putString(KEY_LAST_LNG, String.valueOf(loc.getLongitude()))
            .putFloat(KEY_LAST_ACCURACY, loc.hasAccuracy() ? loc.getAccuracy() : -1f)
            .apply();
        networkExecutor.execute(() -> postLocation(loc, driverId, cloudUrl, now));
    }

    private void postLocation(Location loc, String driverId, String cloudUrl, long at) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        HttpURLConnection conn = null;
        try {
            JSONObject location = new JSONObject();
            location.put("lat", loc.getLatitude());
            location.put("lng", loc.getLongitude());
            location.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : JSONObject.NULL);
            location.put("heading", loc.hasBearing() ? loc.getBearing() : JSONObject.NULL);
            location.put("speed", loc.hasSpeed() ? loc.getSpeed() : JSONObject.NULL);
            location.put("at", at);

            JSONObject body = new JSONObject();
            body.put("driverId", driverId);
            body.put("location", location);

            URL url = new URL(cloudUrl.replaceAll("/+$", "") + "/api/driver/location");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();

            if (code >= 200 && code < 300) {
                int count = prefs.getInt(KEY_PUSH_COUNT, 0) + 1;
                prefs.edit()
                    .putLong(KEY_LAST_SYNC_AT, System.currentTimeMillis())
                    .putInt(KEY_PUSH_COUNT, count)
                    .remove(KEY_LAST_ERROR)
                    .apply();
            } else {
                prefs.edit().putString(KEY_LAST_ERROR, "HTTP " + code).apply();
            }
        } catch (JSONException | IOException e) {
            prefs.edit().putString(KEY_LAST_ERROR, e.getMessage()).apply();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopLocationUpdates();
        if (networkExecutor != null) networkExecutor.shutdown();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
