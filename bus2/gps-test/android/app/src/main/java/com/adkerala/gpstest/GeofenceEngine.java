package com.adkerala.gpstest;

import org.json.JSONObject;

import java.util.List;

/**
 * Standalone Java port of bus2/src/lib/gpsAutoDrive.js's evaluateGpsDeparture() — same
 * algorithm, same defaults (80m fallback radius, 25m exit hysteresis, 60m max accuracy, 20s
 * cooldown between advances). Deliberately reimplemented rather than shared/imported: this test
 * app must stay fully isolated from the real driver app's code, so nothing here can ever
 * accidentally pull in (or diverge silently from, without it being an explicit port decision)
 * production logic.
 *
 * Runs inside GpsTestService — the foreground service itself, not the WebView/JS layer — so the
 * arrive/depart decision keeps working even if Android suspends the app's JS context in the
 * background. The JS UI only displays whatever this engine has already decided.
 */
public class GeofenceEngine {

    public static class Stop {
        public final String name;
        public final double lat;
        public final double lng;
        public final double radiusM;

        public Stop(String name, double lat, double lng, double radiusM) {
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.radiusM = radiusM;
        }
    }

    public interface EventListener {
        /** type: "arrived" | "departed" | "trip-complete" | "approaching" | "awaiting-exit" |
         *  "waiting" | "cooldown". data may be null for pure-status types. */
        void onEvent(String type, String message, JSONObject data);
    }

    private static final double DEFAULT_RADIUS_M = 80;
    private static final double HYSTERESIS_M = 25;
    private static final double MAX_ACCURACY_M = 60;
    private static final long COOLDOWN_MS = 20_000;

    private final List<Stop> stops;
    private int currentIndex = 0;
    private boolean tripEnded = false;
    private boolean wasInside = false;
    private long lastAdvanceAt = 0;

    public GeofenceEngine(List<Stop> stops) {
        this.stops = stops;
    }

    public int getCurrentIndex() {
        return currentIndex;
    }

    public boolean isTripEnded() {
        return tripEnded;
    }

    public Stop getCurrentStop() {
        if (currentIndex < 0 || currentIndex >= stops.size()) return null;
        return stops.get(currentIndex);
    }

    /** Call on every location fix. */
    public void evaluate(double lat, double lng, Float accuracy, EventListener listener) {
        if (tripEnded || stops.isEmpty()) return;

        if (accuracy != null && accuracy > MAX_ACCURACY_M) {
            listener.onEvent("waiting", "GPS accuracy too low (" + Math.round(accuracy) + "m) — waiting…", null);
            return;
        }

        Stop stop = stops.get(currentIndex);
        double dist = distanceMetres(lat, lng, stop.lat, stop.lng);
        double radius = stop.radiusM > 0 ? stop.radiusM : DEFAULT_RADIUS_M;
        double exitThreshold = radius + HYSTERESIS_M;

        long now = System.currentTimeMillis();
        if (lastAdvanceAt != 0 && now - lastAdvanceAt < COOLDOWN_MS) {
            listener.onEvent("cooldown", "Cooldown — watching " + stop.name, distData(stop, dist));
            return;
        }

        boolean inside = dist <= radius;
        boolean outsideExit = dist >= exitThreshold;

        if (inside) {
            if (!wasInside) {
                listener.onEvent("arrived", "Arrived: " + stop.name + " (" + Math.round(dist) + "m)", distData(stop, dist));
            }
            wasInside = true;
            return;
        }

        if (wasInside && outsideExit) {
            wasInside = false;
            lastAdvanceAt = now;
            currentIndex++;
            if (currentIndex >= stops.size()) {
                tripEnded = true;
                listener.onEvent("trip-complete", "Departed " + stop.name + " — trip complete", distData(stop, dist));
            } else {
                Stop next = stops.get(currentIndex);
                listener.onEvent("departed", "Departed " + stop.name + " → watching " + next.name, distData(stop, dist));
            }
            return;
        }

        listener.onEvent(
            wasInside ? "awaiting-exit" : "approaching",
            (wasInside ? "Leaving " : "Approaching ") + stop.name + " (" + Math.round(dist) + "m)",
            distData(stop, dist)
        );
    }

    private JSONObject distData(Stop stop, double dist) {
        try {
            JSONObject o = new JSONObject();
            o.put("stop", stop.name);
            o.put("distanceM", Math.round(dist));
            o.put("stopIndex", currentIndex);
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    public static double distanceMetres(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return r * c;
    }
}
