package com.adkerala.display;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Silent, zero-tap self-update for Android display units — the Android counterpart to
 * kiosk/updater.cjs on PC. Requires this app to be enrolled as Device Owner (see
 * AdKeralaDeviceAdminReceiver + ANDROID-UPDATE.md) — PackageInstaller sessions committed by a
 * Device Owner app install without any confirmation dialog. On a non-enrolled device this class
 * still runs (harmless) but every install attempt fails with STATUS_PENDING_USER_ACTION, logged
 * clearly so that's an obvious, diagnosable field symptom rather than a silent no-op.
 *
 * Same shape as PC: checks once at boot, then every CHECK_INTERVAL_MS; trip-aware install
 * timing (defers while a trip is in progress, same `Boolean(tripStarted) && !tripEnded` check
 * as kiosk/updater.cjs's isTripInProgress()) *unless* the installed version is below the cloud's
 * minAndroidVersion, in which case it installs immediately regardless — same escape hatch PC's
 * minPcVersion enforcement has.
 */
public class AdKeralaUpdateChecker {

    private static final String TAG = "AdKeralaUpdate";
    private static final long CHECK_INTERVAL_MS = 15 * 60 * 1000; // matches kiosk/updater.cjs
    private static final long BOOT_CHECK_DELAY_MS = 20 * 1000; // let the embedded server come up first
    private static final long TRIP_RECHECK_MS = 60 * 1000;
    private static final String ACTION_INSTALL_COMPLETE = "com.adkerala.display.INSTALL_COMPLETE";
    private static final String NOTIFICATION_CHANNEL_ID = "adkerala-updates";
    private static final int NOTIFICATION_ID_STATUS = 1001;
    private static final int NOTIFICATION_ID_ACTION_NEEDED = 1002;

    private final Context context;
    private final String cloudUrl;
    private final int localPort;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean installInFlight = false;

    public AdKeralaUpdateChecker(Context context, String cloudUrl, int localPort) {
        this.context = context.getApplicationContext();
        this.cloudUrl = cloudUrl.replaceAll("/+$", "");
        this.localPort = localPort;

        IntentFilter filter = new IntentFilter(ACTION_INSTALL_COMPLETE);
        ContextCompat.registerReceiver(this.context, installReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        ensureNotificationChannel();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID, "AdKerala updates", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Update check / install status for the AdKerala display app");
        manager.createNotificationChannel(channel);
    }

    /** Quiet, informational status notification — visible in the shade for anyone watching a
     * test device, but IMPORTANCE_LOW (no sound/heads-up) so it doesn't interrupt the passenger
     * display. Not shown on Device-Owner-enrolled production units unless someone pulls the
     * shade down; the point is testability, not a passenger-facing feature. */
    private void notifyStatus(String title, String text) {
        if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
            != android.content.pm.PackageManager.PERMISSION_GRANTED
            && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return; // not granted — see MainActivity's request; notifications are a bonus, never required
        }
        Notification notification = new NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
            .build();
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID_STATUS, notification);
    }

    /** The actual "so they can press and install" fallback: when this device isn't Device-Owner
     * enrolled (or enrollment was lost), PackageInstaller can't install silently and instead
     * hands back the normal system confirmation screen as an Intent — wrapping it in a tappable
     * notification is the difference between "update silently never happens, no one notices"
     * and "tester sees a notification, taps it, gets the one-tap install-confirm screen". */
    private void notifyActionNeeded(String version, Intent confirmIntent) {
        if (confirmIntent == null) return;
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context, 0, confirmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("AdKerala update ready — v" + version)
            .setContentText("Tap to install (this device isn't enrolled for silent updates)")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ActivityCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID_ACTION_NEEDED, notification);
        }
    }

    public void start() {
        if (!isDeviceOwner(context)) {
            Log.w(TAG, "not enrolled as Device Owner — updates will require manual tap-through "
                + "if they run at all. See ANDROID-UPDATE.md.");
        }
        handler.postDelayed(this::checkNow, BOOT_CHECK_DELAY_MS);
    }

    private void scheduleNext() {
        handler.postDelayed(this::checkNow, CHECK_INTERVAL_MS);
    }

    private void checkNow() {
        if (installInFlight) {
            scheduleNext();
            return;
        }
        new Thread(this::checkInBackground, "adkerala-update-check").start();
    }

    private void checkInBackground() {
        try {
            JSONObject response = httpGetJson(cloudUrl + "/api/releases/android/latest");
            JSONObject release = response.optJSONObject("release");
            String minVersion = response.isNull("minVersion") ? null : response.optString("minVersion", null);
            String installedVersion = AdKeralaNodeRunner.getInstalledVersionName(context);

            boolean belowMinimum = minVersion != null && compareSemver(installedVersion, minVersion) < 0;

            if (release == null) {
                Log.i(TAG, "no android release registered yet");
                handler.post(this::scheduleNext);
                return;
            }

            String latestVersion = release.optString("version", null);
            String downloadUrl = release.optString("downloadUrl", null);
            if (latestVersion == null || downloadUrl == null || downloadUrl.isEmpty()) {
                handler.post(this::scheduleNext);
                return;
            }

            boolean newerAvailable = compareSemver(latestVersion, installedVersion) > 0;
            if (!newerAvailable && !belowMinimum) {
                Log.i(TAG, "up to date: installed=" + installedVersion + " latest=" + latestVersion);
                handler.post(this::scheduleNext);
                return;
            }

            if (!belowMinimum && isTripInProgress()) {
                Log.i(TAG, "update " + latestVersion + " available but trip in progress — deferring");
                handler.postDelayed(this::checkNow, TRIP_RECHECK_MS);
                return;
            }

            installInFlight = true;
            Log.i(TAG, "installing update " + latestVersion
                + (belowMinimum ? " (forced — below minimum version)" : ""));
            notifyStatus("Installing AdKerala update", "Downloading v" + latestVersion + "…");
            downloadAndInstall(downloadUrl, latestVersion, release.optString("sha256", null));
        } catch (Exception e) {
            Log.w(TAG, "update check failed", e);
            handler.post(this::scheduleNext);
        }
    }

    private boolean isTripInProgress() {
        try {
            JSONObject state = httpGetJson("http://127.0.0.1:" + localPort + "/api/state");
            boolean tripStarted = state.optBoolean("tripStarted", false);
            boolean tripEnded = state.optBoolean("tripEnded", false);
            return tripStarted && !tripEnded;
        } catch (Exception e) {
            // Fails open, same as kiosk/updater.cjs's isTripInProgress() — a local read error
            // must never block an update forever.
            return false;
        }
    }

    private void downloadAndInstall(String downloadUrl, String version, String expectedSha256) {
        File apkFile = new File(context.getCacheDir(), "adkerala-update.apk");
        try {
            downloadToFile(downloadUrl, apkFile);
            if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                String actual = sha256Hex(apkFile);
                if (!actual.equalsIgnoreCase(expectedSha256)) {
                    throw new IOException("checksum mismatch: expected " + expectedSha256 + " got " + actual);
                }
            }
            installSilently(apkFile, version);
        } catch (Exception e) {
            Log.w(TAG, "download/install failed", e);
            installInFlight = false;
            handler.postDelayed(this::checkNow, CHECK_INTERVAL_MS);
        }
    }

    private void downloadToFile(String url, File dest) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        try (InputStream in = conn.getInputStream();
             OutputStream out = new FileOutputStream(dest)) {
            copyStream(in, out);
        } finally {
            conn.disconnect();
        }
    }

    private static void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }

    private String sha256Hex(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : digest.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** Commits a PackageInstaller session — installs without any confirmation dialog only
     * because this app is Device Owner (see class doc comment). On a non-enrolled device this
     * still commits the session; PackageInstaller just responds with STATUS_PENDING_USER_ACTION
     * instead of STATUS_SUCCESS (handled below, via notifyActionNeeded). */
    private void installSilently(File apkFile, String version) throws IOException {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int sessionId = installer.createSession(params);
        PackageInstaller.Session session = installer.openSession(sessionId);
        try {
            try (OutputStream out = session.openWrite("adkerala-display", 0, apkFile.length());
                 InputStream in = new FileInputStream(apkFile)) {
                copyStream(in, out);
                session.fsync(out);
            }
            Intent completeIntent = new Intent(ACTION_INSTALL_COMPLETE).putExtra("version", version);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context, sessionId, completeIntent, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(pendingIntent.getIntentSender());
        } finally {
            session.close();
        }
    }

    private final BroadcastReceiver installReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            String version = intent.getStringExtra("version");
            installInFlight = false;
            if (status == PackageInstaller.STATUS_SUCCESS) {
                Log.i(TAG, "update installed successfully — app will restart");
                notifyStatus("AdKerala updated", "Now on v" + version);
            } else if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                // This is exactly the failure mode when Device Owner isn't actually set —
                // PackageInstaller falls back to requiring the confirmation dialog that the
                // whole point of Device Owner enrollment was to skip. Loud, specific log line
                // so this is diagnosable from `adb logcat` rather than looking like an update
                // that "just doesn't happen" with no explanation — and, since this is the exact
                // "so they can press and install" case, a tappable notification wrapping the
                // system confirmation screen the intent carries, so a tester doesn't need adb at
                // all to finish the install.
                Log.w(TAG, "install requires user confirmation — this device is NOT enrolled "
                    + "as Device Owner (or enrollment was lost). See ANDROID-UPDATE.md.");
                @SuppressWarnings("deprecation") // typed getParcelableExtra(String, Class) needs API 33+; this still works
                Intent confirmIntent = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                notifyActionNeeded(version, confirmIntent);
            } else {
                Log.w(TAG, "install failed, status=" + status + " message=" + message);
            }
            // Inside this anonymous BroadcastReceiver, `this` means the receiver itself, not
            // AdKeralaUpdateChecker — plain `this::scheduleNext` never resolved (real compile
            // error). Qualify the outer class explicitly.
            handler.post(AdKeralaUpdateChecker.this::scheduleNext);
        }
    };

    private JSONObject httpGetJson(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        try (InputStream in = conn.getInputStream()) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            copyStream(in, buffer);
            return new JSONObject(buffer.toString("UTF-8"));
        } finally {
            conn.disconnect();
        }
    }

    static int compareSemver(String a, String b) {
        String[] pa = (a == null ? "0" : a).split("\\.");
        String[] pb = (b == null ? "0" : b).split("\\.");
        int len = Math.max(pa.length, pb.length);
        for (int i = 0; i < len; i++) {
            int av = parsePart(pa, i);
            int bv = parsePart(pb, i);
            if (av != bv) return Integer.compare(av, bv);
        }
        return 0;
    }

    private static int parsePart(String[] parts, int i) {
        if (i >= parts.length) return 0;
        try {
            return Integer.parseInt(parts[i].replaceAll("[^0-9].*$", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    public static boolean isDeviceOwner(Context context) {
        DevicePolicyManager dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isDeviceOwnerApp(context.getPackageName());
    }
}
