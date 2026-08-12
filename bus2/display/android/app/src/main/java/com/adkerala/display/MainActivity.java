package com.adkerala.display;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

import java.util.Collections;

/**
 * Passenger display shell. Starts the embedded local server (AdKeralaNodeRunner — same
 * server/prod.js code the Electron kiosk app runs) on boot, shows the bundled splash
 * (capacitor.config.ts's webDir: 'www') while it comes up, then navigates the WebView to
 * http://127.0.0.1:5174/display?kiosk=1&autofs=1 once it answers — mirrors kiosk/main.cjs's
 * createWindow()+waitForServer() sequence for the Electron kiosk app.
 *
 * Also wires up the ESP32 stop-announcement console (AdKeralaSerialManager) — the JS-side
 * contract it satisfies (window.adKeralaAndroid, src/hooks/useAndroidSerialBridge.js) is injected
 * via WebViewCompat.addDocumentStartJavaScript rather than replacing Capacitor's own
 * WebViewClient, so navigating the WebView between the splash and the embedded server's /display
 * page (a different origin) doesn't disturb whatever Capacitor itself still relies on its client
 * for. The native half of the bridge (AdKeralaSerialBridge) is added via addJavascriptInterface,
 * which — unlike page-scoped JS — persists across navigations on the same WebView instance.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "AdKeralaDisplay";
    // Overridable at build time for deployments pointed at a non-default cloud host — matches
    // shared/cloudUrls.js's DEFAULT_PUBLIC_CLOUD_URL, the same default the PC kiosk app falls
    // back to when ADKERALA_CLOUD_URL isn't set.
    private static final String CLOUD_URL = "https://adkerala.com";

    // Defines window.adKeralaAndroid by wrapping the native object addJavascriptInterface below
    // exposes as window.AdKeralaSerialNative — see AdKeralaSerialBridge's own doc comment for why
    // this indirection exists (raw Java-backed JS objects only expose methods, not the plain
    // `serialSupported` boolean property src/lib/appRole.js's isBusPcForSerial() checks).
    private static final String SERIAL_BRIDGE_SHIM =
        "(function() {"
            + "if (window.adKeralaAndroid) return;"
            + "window.adKeralaAndroid = {"
            + "  serialSupported: true,"
            + "  kiosk: true,"
            + "  requestSerialStatus: function() { window.AdKeralaSerialNative.requestSerialStatus(); },"
            + "  openSerialSettings: function() { window.AdKeralaSerialNative.openSerialSettings(); },"
            + "  disconnectSerial: function() { window.AdKeralaSerialNative.disconnectSerial(); },"
            + "  reconnectSerial: function() { window.AdKeralaSerialNative.reconnectSerial(); }"
            + "};"
            + "})();";

    private AdKeralaSerialManager serialManager;

    // Read by AdKeralaUpdateChecker's foreground watchdog — this is a kiosk display that should
    // never legitimately sit behind another window, so "not foreground for more than a couple of
    // watchdog cycles" is treated as a stuck relaunch, not a normal app-lifecycle event. See
    // AdKeralaRelaunch's doc comment for the field case (v1.0.29) this closes: an update whose
    // relaunch silently failed to bring the Activity to the foreground while the embedded
    // server + update checker (both started from onCreate below) kept running and reporting
    // "online" to cloud, with nothing to notice or correct it before this watchdog existed.
    static volatile boolean isForeground = false;

    @Override
    public void onResume() {
        super.onResume();
        isForeground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        isForeground = false;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Best-effort — AdKeralaUpdateChecker's notifications already no-op gracefully if this
        // is never granted (see its own guard logic), and there's no rationale UI needed for a
        // single-purpose kiosk app with no one around to read a dialog anyway. API 33+ only;
        // a no-op call below that.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        }

        WebView webView = bridge.getWebView();
        serialManager = new AdKeralaSerialManager(getApplicationContext(), webView);
        webView.addJavascriptInterface(new AdKeralaSerialBridge(serialManager), "AdKeralaSerialNative");

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, SERIAL_BRIDGE_SHIM, Collections.singleton("*"));
        } else {
            // Old WebView (pre-~API 26 WebView component) — src/hooks/useAndroidSerialBridge.js
            // safely no-ops without window.adKeralaAndroid, so this only means no ESP32 support
            // on that specific device, not a crash.
            Log.w(TAG, "WebView doesn't support DOCUMENT_START_SCRIPT — ESP32 serial disabled on this device");
        }

        AdKeralaNodeRunner runner = new AdKeralaNodeRunner();
        runner.start(getApplicationContext(), CLOUD_URL, new AdKeralaNodeRunner.ReadyCallback() {
            @Override
            public void onReady(String displayUrl) {
                Log.i(TAG, "embedded server ready, loading " + displayUrl);
                runOnUiThread(() -> {
                    webView.getSettings().setDomStorageEnabled(true);
                    webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
                    webView.loadUrl(displayUrl);
                    // Auto-connect to whatever ESP32 console is already attached — zero
                    // interaction, mirroring Electron's session.setDevicePermissionHandler on PC.
                    serialManager.connect();
                });
                new AdKeralaUpdateChecker(getApplicationContext(), CLOUD_URL, AdKeralaNodeRunner.PORT).start();
            }

            @Override
            public void onFailed(String reason) {
                Log.e(TAG, "embedded server failed to start: " + reason);
                // Left showing the bundled splash (www/index.html) rather than a bare error
                // page — a display unit stuck on the splash is a clearer field symptom (and one
                // `adb logcat -s AdKeralaDisplay AdKeralaNode` immediately explains) than a
                // WebView error screen with no obvious next step for whoever's looking at it.
            }
        });
    }
}
