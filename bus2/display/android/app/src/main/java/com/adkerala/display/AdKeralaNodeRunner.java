package com.adkerala.display;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;

/**
 * Starts the same local server the Electron kiosk app runs (server/prod.js, via the
 * server/androidMain.js boot entry) embedded in-process via nodejs-mobile's native-gradle
 * integration (native-lib.cpp calling node::Start()) — mirrors kiosk/main.cjs's serverChild
 * lifecycle, minus the fork/restart machinery nodejs-mobile can't support (see androidMain.js's
 * own doc comment for what that means for hot-patching).
 *
 * See display/LIBNODE-SETUP.md for the one-time manual step this depends on (downloading
 * nodejs-mobile's prebuilt libnode binaries — not committed to this repo).
 */
public class AdKeralaNodeRunner {

    private static final String TAG = "AdKeralaNode";
    private static final String PREFS_NAME = "adkerala-node-runner";
    private static final String PREF_LAST_UPDATE_TIME = "lastApkUpdateTime";
    private static final String NODE_PROJECT_ASSET_DIR = "nodejs-project";
    private static final String NODE_PROJECT_DIR_NAME = "nodejs-project";
    private static final String DATA_DIR_NAME = "adkerala-data";
    private static final String CONFIG_FILE_NAME = "adkerala-android-config.json";
    /** Must match server/androidMain.js's fallback and kiosk/main.cjs's DISPLAY_URL port. */
    public static final int PORT = 5174;

    static {
        // Load order matters: native-lib.so links against libnode.so at build time via
        // CMakeLists.txt's IMPORTED target, so libnode must already be resident when
        // native-lib loads.
        System.loadLibrary("node");
        System.loadLibrary("native-lib");
    }

    private native Integer startNodeWithArguments(String[] arguments);

    public interface ReadyCallback {
        void onReady(String displayUrl);

        void onFailed(String reason);
    }

    /**
     * Copies the bundled node project + writes a fresh config, starts the embedded server on a
     * dedicated background thread (startNodeWithArguments blocks for the process's lifetime —
     * node::Start() runs the event loop in-place), then polls the HTTP port until it answers,
     * mirroring waitForServer() in kiosk/main.cjs. Safe to call once per app process lifetime.
     */
    public void start(Context context, String cloudUrl, ReadyCallback callback) {
        new Thread(() -> {
            try {
                File nodeProjectDir = ensureNodeProjectCopied(context);
                File dataRoot = new File(context.getFilesDir(), DATA_DIR_NAME);
                //noinspection ResultOfMethodCallIgnored
                dataRoot.mkdirs();
                File configFile = writeAndroidConfig(context, dataRoot, cloudUrl);

                String entryScript = new File(nodeProjectDir, "server/androidMain.js").getAbsolutePath();
                Log.i(TAG, "starting embedded node: " + entryScript);

                // This call does not return while the server is running — node::Start() only
                // returns when the process's event loop drains (i.e. on shutdown). Runs on this
                // dedicated thread for the app's whole lifetime; the WebView talks to it purely
                // over HTTP, same as the Electron kiosk app talks to its own child process.
                new Thread(() -> startNodeWithArguments(
                        new String[]{"node", entryScript, configFile.getAbsolutePath()}
                ), "adkerala-node").start();
            } catch (Exception e) {
                Log.e(TAG, "failed to prepare embedded node project", e);
                callback.onFailed(e.getMessage());
                return;
            }

            waitForServerReady(callback);
        }, "adkerala-node-bootstrap").start();
    }

    private void waitForServerReady(ReadyCallback callback) {
        String healthUrl = "http://127.0.0.1:" + PORT + "/";
        String displayUrl = "http://127.0.0.1:" + PORT + "/display?kiosk=1&autofs=1";
        int attempts = 45; // ~45s, matching kiosk/main.cjs's waitForServer default
        for (int i = 0; i < attempts; i++) {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(healthUrl).openConnection();
                conn.setConnectTimeout(2000);
                conn.setReadTimeout(2000);
                int code = conn.getResponseCode();
                conn.disconnect();
                if (code < 500) {
                    callback.onReady(displayUrl);
                    return;
                }
            } catch (IOException ignored) {
                // Server not up yet — expected during the first few attempts.
            }
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                callback.onFailed("interrupted while waiting for embedded server");
                return;
            }
        }
        callback.onFailed("embedded server did not respond within " + attempts + "s");
    }

    private File writeAndroidConfig(Context context, File dataRoot, String cloudUrl) throws IOException {
        File configFile = new File(context.getFilesDir(), CONFIG_FILE_NAME);
        JSONObject json = new JSONObject();
        try {
            json.put("dataRoot", dataRoot.getAbsolutePath());
            json.put("cloudUrl", cloudUrl);
            json.put("port", PORT);
            // Real installed APK version, not the embedded server bundle's own placeholder
            // package.json version — see server/version.js's comment. Threaded through so
            // telemetry (server/cloudSync.js's buildTelemetry) reports what's actually installed.
            json.put("appVersion", getInstalledVersionName(context));
        } catch (Exception e) {
            throw new IOException("failed to build android config json", e);
        }
        try (FileOutputStream out = new FileOutputStream(configFile)) {
            out.write(json.toString().getBytes("UTF-8"));
        }
        return configFile;
    }

    /** Same PackageInfo the update checker (AdKeralaUpdateChecker) compares against — the one
     * source of truth for "what version is actually installed on this device". */
    static String getInstalledVersionName(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName != null ? info.versionName : "0.0.0";
        } catch (PackageManager.NameNotFoundException e) {
            return "0.0.0";
        }
    }

    /**
     * Re-copies assets/nodejs-project into app-private storage whenever the APK itself was
     * updated (detected via PackageInfo.lastUpdateTime, same technique the upstream
     * nodejs-mobile-android sample uses) — the copied project dir is disposable/rebuildable, so
     * always safe to overwrite. db/ + hub sessions live in a *separate* DATA_DIR_NAME directory
     * (see start()) that this never touches, so an app update never wipes bus state.
     */
    private File ensureNodeProjectCopied(Context context) throws IOException {
        File nodeProjectDir = new File(context.getFilesDir(), NODE_PROJECT_DIR_NAME);
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long lastUpdateTime = prefs.getLong(PREF_LAST_UPDATE_TIME, 0);

        long currentUpdateTime;
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            currentUpdateTime = info.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            currentUpdateTime = -1;
        }

        boolean needsCopy = !nodeProjectDir.exists() || currentUpdateTime != lastUpdateTime;
        if (needsCopy) {
            Log.i(TAG, "copying nodejs-project assets (app updated or first run)");
            deleteRecursive(nodeProjectDir);
            copyAssetFolder(context, NODE_PROJECT_ASSET_DIR, nodeProjectDir);
            prefs.edit().putLong(PREF_LAST_UPDATE_TIME, currentUpdateTime).apply();
        }
        return nodeProjectDir;
    }

    private void copyAssetFolder(Context context, String assetPath, File targetDir) throws IOException {
        String[] entries = context.getAssets().list(assetPath);
        if (entries == null) {
            throw new IOException("nodejs-project assets missing at " + assetPath
                    + " — run `npm run build:display-bundle` before syncing the Android project");
        }
        //noinspection ResultOfMethodCallIgnored
        targetDir.mkdirs();
        if (entries.length == 0) {
            // Leaf file, not a directory.
            copyAssetFile(context, assetPath, targetDir);
            return;
        }
        for (String entry : entries) {
            String childAssetPath = assetPath + "/" + entry;
            String[] childEntries = context.getAssets().list(childAssetPath);
            File childTarget = new File(targetDir, entry);
            if (childEntries != null && childEntries.length > 0) {
                copyAssetFolder(context, childAssetPath, childTarget);
            } else {
                copyAssetFile(context, childAssetPath, targetDir);
            }
        }
    }

    private void copyAssetFile(Context context, String assetPath, File targetDir) throws IOException {
        String fileName = assetPath.substring(assetPath.lastIndexOf('/') + 1);
        File targetFile = new File(targetDir, fileName);
        try (InputStream in = context.getAssets().open(assetPath);
             OutputStream out = new FileOutputStream(targetFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }

    private void deleteRecursive(File file) {
        if (!file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursive(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
