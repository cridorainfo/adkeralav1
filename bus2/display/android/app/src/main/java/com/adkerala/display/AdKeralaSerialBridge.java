package com.adkerala.display;

import android.webkit.JavascriptInterface;

/**
 * Exposed to JS as window.AdKeralaSerialNative via WebView.addJavascriptInterface (see
 * MainActivity.java) — a small JS shim, injected alongside it via
 * WebViewCompat.addDocumentStartJavaScript, wraps these into the window.adKeralaAndroid contract
 * src/hooks/useAndroidSerialBridge.js already expects. Kept separate from AdKeralaSerialManager
 * (the actual USB logic) so the @JavascriptInterface surface stays a small, obviously-safe set
 * of fire-and-forget calls — every method here is void by design, matching how
 * useAndroidSerialBridge.js calls them (no return value awaited; results come back later as
 * 'adkerala-serial-status'/'adkerala-serial' CustomEvents).
 */
public class AdKeralaSerialBridge {

    private final AdKeralaSerialManager manager;

    public AdKeralaSerialBridge(AdKeralaSerialManager manager) {
        this.manager = manager;
    }

    @JavascriptInterface
    public void requestSerialStatus() {
        manager.requestStatus();
    }

    @JavascriptInterface
    public void openSerialSettings() {
        // No separate settings UI exists on this non-touch display device — "opening settings"
        // just means "try to (re)connect to whatever console is attached right now", mirroring
        // requestPort() on the PC/Web-Serial path.
        manager.connect();
    }

    @JavascriptInterface
    public void disconnectSerial() {
        manager.disconnect();
    }

    @JavascriptInterface
    public void reconnectSerial() {
        manager.reconnect();
    }
}
