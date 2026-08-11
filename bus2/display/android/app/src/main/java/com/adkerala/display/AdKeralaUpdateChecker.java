package com.adkerala.display;

import android.app.AlarmManager;
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
import android.os.Process;
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
 * kiosk/updater.cjs on PC. Two install mechanisms, tried in order:
 *
 * 1. Huidu vendor SDK (see HuiduSilentInstaller) — on the fleet's Huidu-brand mainboards, their
 *    rooted "Toolbox" system app can install silently on this app's behalf with no enrollment
 *    step at all. Tried first because it needs no per-device setup.
 * 2. Device Owner + PackageInstaller (see AdKeralaDeviceAdminReceiver + ANDROID-UPDATE.md) —
 *    PackageInstaller sessions committed by a Device Owner app install without any confirmation
 *    dialog. Falls back to this whenever the Huidu path is unavailable (non-Huidu hardware, e.g.
 *    test phones) or fails. On a device that's neither Huidu-capable nor Device-Owner-enrolled,
 *    this class still runs (harmless) but every install attempt fails with
 *    STATUS_PENDING_USER_ACTION, logged clearly so that's an obvious, diagnosable field symptom
 *    rather than a silent no-op.
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
        if (!isDeviceOwner(context) && !HuiduSilentInstaller.getInstance(context).isAvailable()) {
            Log.w(TAG, "not enrolled as Device Owner and no Huidu silent-install path available — "
                + "updates will require manual tap-through if they run at all. See ANDROID-UPDATE.md.");
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
            ApkVariant variant = resolveApkVariant(release);
            if (latestVersion == null || variant.downloadUrl == null || variant.downloadUrl.isEmpty()) {
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
            downloadAndInstall(variant.downloadUrl, latestVersion, variant.sha256);
        } catch (Exception e) {
            Log.w(TAG, "update check failed", e);
            handler.post(this::scheduleNext);
        }
    }

    /** downloadUrl + sha256 for one ABI-matched build — see resolveApkVariant(). */
    private static class ApkVariant {
        final String downloadUrl;
        final String sha256;
        ApkVariant(String downloadUrl, String sha256) {
            this.downloadUrl = downloadUrl;
            this.sha256 = sha256;
        }
    }

    /** Picks the download URL + sha256 matching this device's own chipset from
     * `release.variants` (see cloud/releases.js's setAndroidRelease doc comment for the exact
     * shape — keyed by ABI, e.g. "arm64-v8a"/"armeabi-v7a"/"x86_64") — the fleet spans multiple
     * chipsets, not just one, so a single flat downloadUrl can't be right for every device (see
     * build.gradle's abiFilters comment for the history here: a single-ABI or bundle-everything
     * build were both tried and rejected). Build.SUPPORTED_ABIS is already ordered by the
     * device's own preference (its real ABI first, then compatible fallbacks, e.g. an arm64
     * device also lists armeabi-v7a) — walking it in order and taking the first match in
     * `variants` picks the best available build for THIS specific device. Falls back to the
     * flat top-level downloadUrl/sha256 (register-android-release.mjs always populates one, as
     * a default) when there's no `variants` field at all, or when none of this device's ABIs
     * has a registered variant. */
    private ApkVariant resolveApkVariant(JSONObject release) {
        JSONObject variants = release.optJSONObject("variants");
        if (variants != null) {
            for (String abi : Build.SUPPORTED_ABIS) {
                JSONObject match = variants.optJSONObject(abi);
                if (match == null) continue;
                String url = match.optString("downloadUrl", null);
                if (url == null || url.isEmpty()) continue;
                Log.i(TAG, "matched update variant for device ABI " + abi);
                return new ApkVariant(url, match.optString("sha256", null));
            }
            StringBuilder abis = new StringBuilder();
            for (String abi : Build.SUPPORTED_ABIS) {
                if (abis.length() > 0) abis.append(",");
                abis.append(abi);
            }
            Log.w(TAG, "no update variant matches this device's ABIs (" + abis
                + ") — falling back to the default build, which may fail to install");
        }
        return new ApkVariant(release.optString("downloadUrl", null), release.optString("sha256", null));
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

    /** Cache filename is version-scoped (adkerala-update-<version>.apk, not a fixed name) so a
     * partial download for one version can never be mistaken for — and appended onto — a
     * leftover partial file from a different version if the registered release changes mid-
     * download. Any other adkerala-update-*.apk lingering in the cache dir (a different
     * version's abandoned partial, or a fully-downloaded file the app never got to install
     * before being killed) is cleaned up before starting, so cache usage doesn't grow unbounded
     * across retries/versions. */
    private void downloadAndInstall(String downloadUrl, String version, String expectedSha256) {
        File apkFile = new File(context.getCacheDir(), "adkerala-update-" + version + ".apk");
        cleanupStaleUpdateFiles(apkFile);
        try {
            downloadToFile(downloadUrl, apkFile);
            if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                String actual = sha256Hex(apkFile);
                if (!actual.equalsIgnoreCase(expectedSha256)) {
                    // Don't leave a corrupted file around to be "resumed" from next attempt —
                    // that would just compound the corruption instead of self-healing.
                    apkFile.delete();
                    throw new IOException("checksum mismatch: expected " + expectedSha256 + " got " + actual);
                }
            }

            // Huidu vendor path first — no Device Owner enrollment needed on this hardware, see
            // HuiduSilentInstaller's doc comment. isAvailable() is false on any device without
            // toolkit.jar bundled (e.g. test phones), so this is a no-op fall-through there.
            HuiduSilentInstaller huidu = HuiduSilentInstaller.getInstance(context);
            if (huidu.isAvailable()) {
                if (huidu.install(apkFile.getAbsolutePath())) {
                    apkFile.delete();
                    restartAfterHuiduInstall(version);
                    return;
                }
                Log.w(TAG, "Huidu install() reported failure — falling back to Device Owner / "
                    + "PackageInstaller path");
            }

            installSilently(apkFile, version);
            apkFile.delete(); // bytes are already inside the PackageInstaller session by now
        } catch (Exception e) {
            Log.w(TAG, "download/install failed", e);
            installInFlight = false;
            handler.postDelayed(this::checkNow, CHECK_INTERVAL_MS);
        }
    }

    /** Huidu's install() (unlike installAndStart) only installs — it doesn't relaunch, and per
     * the manual installAndStart doesn't work on Toolbox 2.0+ anyway, so relaunching ourselves
     * here works uniformly across Toolbox generations instead of depending on that caveat-laden
     * call. Schedules MainActivity to reopen via AlarmManager, then kills this process — same
     * "exit and let the alarm bring it back up on the new bytes" shape as a normal silent update
     * restart, and reuses AdKeralaBootReceiver's own launch flags/intent shape. */
    private void restartAfterHuiduInstall(String version) {
        Log.i(TAG, "Huidu silent install succeeded (v" + version + ") — restarting to apply it");
        notifyStatus("AdKerala updated", "Now on v" + version);
        Intent relaunch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (relaunch == null) {
            relaunch = new Intent(context, com.adkerala.display.MainActivity.class);
        }
        relaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context, 0, relaunch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.set(AlarmManager.RTC, System.currentTimeMillis() + 2000, pendingIntent);
        } else {
            Log.w(TAG, "no AlarmManager — relying on AdKeralaBootReceiver/manual relaunch instead");
        }
        installInFlight = false;
        handler.postDelayed(() -> Process.killProcess(Process.myPid()), 500);
    }

    private void cleanupStaleUpdateFiles(File keep) {
        File[] files = context.getCacheDir().listFiles(
            (dir, name) -> name.startsWith("adkerala-update-") && name.endsWith(".apk"));
        if (files == null) return;
        for (File f : files) {
            if (!f.equals(keep)) f.delete();
        }
    }

    /** Resumes a partial download via HTTP Range instead of restarting from byte 0 every time —
     * on a moving bus, a flaky connection stalling past the 60s read timeout used to mean every
     * retry re-downloaded the full ~50-60MB APK from scratch (new FileOutputStream(dest) with no
     * append flag truncated whatever was already there), so a sufficiently unstable connection
     * could make an update take hours without ever actually finishing — this is exactly that
     * fix. GitHub Releases (where these APKs are hosted) serves static assets and supports Range
     * requests. Falls back to a clean full restart if the server doesn't honor the Range header
     * (plain 200 instead of 206) rather than risk appending onto data that isn't actually a
     * continuation. */
    private void downloadToFile(String url, File dest) throws IOException {
        long existingBytes = dest.exists() ? dest.length() : 0;
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        if (existingBytes > 0) {
            conn.setRequestProperty("Range", "bytes=" + existingBytes + "-");
        }
        try {
            int responseCode = conn.getResponseCode();
            if (responseCode == 416) {
                // "Range Not Satisfiable" — existingBytes already covers the whole file, most
                // likely because a previous attempt finished the download but the app was
                // killed/restarted before installSilently ran. Nothing left to fetch; the
                // caller's sha256 check confirms whether what's on disk is actually good (and
                // deletes it to force a clean restart next time if not).
                Log.i(TAG, "resume: server reports nothing left to download, reusing cached file ("
                    + existingBytes + " bytes)");
                return;
            }
            boolean resuming = existingBytes > 0 && responseCode == HttpURLConnection.HTTP_PARTIAL;
            if (existingBytes > 0 && !resuming) {
                Log.i(TAG, "server doesn't support resume for this URL — restarting download from 0");
            } else if (resuming) {
                Log.i(TAG, "resuming download from byte " + existingBytes);
            }
            try (InputStream in = conn.getInputStream();
                 OutputStream out = new FileOutputStream(dest, resuming)) {
                copyStream(in, out);
            }
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
