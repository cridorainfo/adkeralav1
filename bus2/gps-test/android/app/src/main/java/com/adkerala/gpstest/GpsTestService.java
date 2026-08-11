package com.adkerala.gpstest;

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

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The actual reliability test: a foreground service (same pattern as the real driver app's
 * GpsTrackingService, see that file's doc comment) that runs GeofenceEngine against live GPS
 * fixes independently of the WebView — survives the app being backgrounded, screen off, or the
 * phone in a pocket for the whole commute. Everything the engine decides is persisted to
 * SharedPreferences immediately (so the local event log is authoritative even with zero
 * connectivity the entire test), then best-effort synced to the cloud in the background.
 */
public class GpsTestService extends Service {

    public static final String PREFS = "adkerala_gpstest";
    public static final String KEY_ROUTE_ID = "routeId";
    public static final String KEY_ROUTE_NAME = "routeName";
    public static final String KEY_DIRECTION = "direction";
    public static final String KEY_CLOUD_URL = "cloudUrl";
    public static final String KEY_STOPS_JSON = "stopsJson";
    public static final String KEY_RUNNING = "running";
    public static final String KEY_PHASE = "phase";
    public static final String KEY_DETAIL = "detail";
    public static final String KEY_LAST_FIX_AT = "lastFixAt";
    public static final String KEY_LAST_ACCURACY = "lastAccuracy";
    public static final String KEY_PUSH_COUNT = "pushCount";
    public static final String KEY_EVENTS_JSON = "eventsJson";
    public static final String KEY_PENDING_JSON = "pendingJson";
    public static final String ACTION_STOP = "com.adkerala.gpstest.ACTION_STOP";

    private static final String TAG = "GpsTestService";
    private static final String CHANNEL_ID = "adkerala_gpstest";
    private static final int NOTIFICATION_ID = 2001;
    private static final long INTERVAL_MS = 4000;
    private static final long MIN_UPDATE_INTERVAL_MS = 2000;
    // Local event log is capped so SharedPreferences (backed by a single XML file) never grows
    // unbounded across a long test run — a multi-hour commute test easily produces more events
    // than anyone needs to review; the newest MAX_EVENTS are what matter.
    private static final int MAX_EVENTS = 500;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private ExecutorService networkExecutor;
    private GeofenceEngine engine;
    private String cloudUrl;
    private String routeId;
    private String direction;

    @Override
    public void onCreate() {
        super.onCreate();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        networkExecutor = Executors.newSingleThreadExecutor();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            getPrefs().edit().putBoolean(KEY_RUNNING, false).apply();
            stopLocationUpdates();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent == null || !intent.hasExtra(KEY_STOPS_JSON)) {
            // Restarted by the system (START_STICKY) with no fresh config — resume from prefs
            // if we were running, otherwise there's nothing to do.
            if (!getPrefs().getBoolean(KEY_RUNNING, false)) {
                stopSelf();
                return START_NOT_STICKY;
            }
        } else {
            cloudUrl = intent.getStringExtra(KEY_CLOUD_URL);
            routeId = intent.getStringExtra(KEY_ROUTE_ID);
            direction = intent.getStringExtra(KEY_DIRECTION);
            String routeName = intent.getStringExtra(KEY_ROUTE_NAME);
            String stopsJson = intent.getStringExtra(KEY_STOPS_JSON);

            List<GeofenceEngine.Stop> stops = parseStops(stopsJson);
            engine = new GeofenceEngine(stops);

            getPrefs().edit()
                .putBoolean(KEY_RUNNING, true)
                .putString(KEY_ROUTE_ID, routeId)
                .putString(KEY_ROUTE_NAME, routeName)
                .putString(KEY_DIRECTION, direction)
                .putString(KEY_CLOUD_URL, cloudUrl)
                .putString(KEY_STOPS_JSON, stopsJson)
                .putString(KEY_PHASE, "watching")
                .putString(KEY_DETAIL, "Waiting for first GPS fix…")
                .putInt(KEY_PUSH_COUNT, 0)
                .putString(KEY_EVENTS_JSON, "[]")
                .putString(KEY_PENDING_JSON, "[]")
                .apply();
        }

        if (engine == null) {
            // Process restarted mid-test (e.g. OEM killed it) — rebuild the engine from prefs so
            // tracking resumes, though the in-memory geofence state (wasInside/cooldown) resets;
            // the persisted event log itself is untouched.
            SharedPreferences p = getPrefs();
            cloudUrl = p.getString(KEY_CLOUD_URL, null);
            routeId = p.getString(KEY_ROUTE_ID, null);
            direction = p.getString(KEY_DIRECTION, null);
            engine = new GeofenceEngine(parseStops(p.getString(KEY_STOPS_JSON, "[]")));
        }

        startForegroundCompat();
        startLocationUpdates();
        return START_STICKY;
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private List<GeofenceEngine.Stop> parseStops(String json) {
        List<GeofenceEngine.Stop> stops = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String name = o.optString("en", "Stop " + (i + 1));
                double lat = o.optDouble("lat", Double.NaN);
                double lng = o.optDouble("lng", Double.NaN);
                double radius = o.optDouble("radiusM", 80);
                if (!Double.isNaN(lat) && !Double.isNaN(lng)) {
                    stops.add(new GeofenceEngine.Stop(name, lat, lng, radius));
                }
            }
        } catch (JSONException e) {
            Log.e(TAG, "bad stops JSON", e);
        }
        return stops;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "GPS reliability test", NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("Shows live stop-progression test status");
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void startForegroundCompat() {
        updateNotification("Watching…", "GPS test running");
    }

    private void updateNotification(String title, String text) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startLocationUpdates() {
        if (locationCallback != null) return;

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) onFix(loc);
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

    private void onFix(Location loc) {
        long now = System.currentTimeMillis();
        Float accuracy = loc.hasAccuracy() ? loc.getAccuracy() : null;
        getPrefs().edit()
            .putLong(KEY_LAST_FIX_AT, now)
            .putFloat(KEY_LAST_ACCURACY, accuracy != null ? accuracy : -1f)
            .apply();

        if (engine != null) {
            engine.evaluate(loc.getLatitude(), loc.getLongitude(), accuracy, (type, message, data) -> {
                boolean isStatusOnly = "waiting".equals(type) || "approaching".equals(type)
                    || "awaiting-exit".equals(type) || "cooldown".equals(type);
                getPrefs().edit().putString(KEY_PHASE, type).putString(KEY_DETAIL, message).apply();
                updateNotification(message, "AdKerala GPS Test — tap to open");
                // Every transition is logged locally; pure "still watching" status pings are
                // shown live but not spammed into the permanent log.
                if (!isStatusOnly) {
                    JSONObject event = buildEvent(type, message, data, now);
                    appendLocalEvent(event);
                    queueForSync(event);
                }
            });
        }

        // Flush whatever's pending (this fix's event, plus anything still unsent from being
        // offline earlier) in order — this is the whole offline-reliability story: nothing is
        // lost, everything just waits for the next fix after connectivity returns.
        networkExecutor.execute(this::flushPending);
    }

    private JSONObject buildEvent(String type, String message, JSONObject data, long at) {
        JSONObject event = new JSONObject();
        try {
            event.put("type", type);
            event.put("message", message);
            event.put("at", at);
            event.put("routeId", routeId);
            event.put("direction", direction);
            if (data != null) {
                event.put("stop", data.opt("stop"));
                event.put("distanceM", data.opt("distanceM"));
                event.put("stopIndex", data.opt("stopIndex"));
            }
        } catch (JSONException ignored) {
        }
        return event;
    }

    private synchronized void appendLocalEvent(JSONObject event) {
        try {
            JSONArray events = new JSONArray(getPrefs().getString(KEY_EVENTS_JSON, "[]"));
            events.put(event);
            // Trim from the front once over the cap — keep the newest MAX_EVENTS.
            JSONArray trimmed = events;
            if (events.length() > MAX_EVENTS) {
                trimmed = new JSONArray();
                for (int i = events.length() - MAX_EVENTS; i < events.length(); i++) {
                    trimmed.put(events.get(i));
                }
            }
            getPrefs().edit().putString(KEY_EVENTS_JSON, trimmed.toString()).apply();
        } catch (JSONException e) {
            Log.e(TAG, "appendLocalEvent failed", e);
        }
    }

    private synchronized void queueForSync(JSONObject event) {
        try {
            JSONArray pending = new JSONArray(getPrefs().getString(KEY_PENDING_JSON, "[]"));
            pending.put(event);
            getPrefs().edit().putString(KEY_PENDING_JSON, pending.toString()).apply();
        } catch (JSONException e) {
            Log.e(TAG, "queueForSync failed", e);
        }
    }

    /** Best-effort, in-order flush of everything not yet synced. Stops at the first failure so
     * order is preserved for next time rather than silently reordering/dropping — matches how
     * a real driver-app event stream should behave, since this is meant to prove the pattern
     * before it's wired into that app. */
    private synchronized void flushPending() {
        if (cloudUrl == null || cloudUrl.isEmpty()) return;
        JSONArray pending;
        try {
            pending = new JSONArray(getPrefs().getString(KEY_PENDING_JSON, "[]"));
        } catch (JSONException e) {
            return;
        }
        if (pending.length() == 0) return;

        int sent = 0;
        for (int i = 0; i < pending.length(); i++) {
            JSONObject event;
            try {
                event = pending.getJSONObject(i);
            } catch (JSONException e) {
                sent++;
                continue;
            }
            if (!postEvent(event)) break;
            sent++;
        }

        if (sent > 0) {
            JSONArray remaining = new JSONArray();
            for (int i = sent; i < pending.length(); i++) {
                try {
                    remaining.put(pending.get(i));
                } catch (JSONException ignored) {
                }
            }
            int pushCount = getPrefs().getInt(KEY_PUSH_COUNT, 0) + sent;
            getPrefs().edit()
                .putString(KEY_PENDING_JSON, remaining.toString())
                .putInt(KEY_PUSH_COUNT, pushCount)
                .apply();
        }
    }

    private boolean postEvent(JSONObject event) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(cloudUrl.replaceAll("/+$", "") + "/api/testlab/events");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(event.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            return code >= 200 && code < 300;
        } catch (IOException e) {
            return false;
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
