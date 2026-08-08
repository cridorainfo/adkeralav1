package com.adkerala.display;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Required component for this app to be provisioned as Device Owner (one-time, per physical
 * device, via `adb shell dpm set-device-owner com.adkerala.display/.AdKeralaDeviceAdminReceiver`
 * on a freshly-reset device — see ANDROID-UPDATE.md). Device Owner status is what lets
 * AdKeralaUpdateChecker install APK updates through PackageInstaller with zero user interaction;
 * this receiver itself doesn't need to enforce any device policies — no MDM restrictions, no
 * kiosk lockdown beyond what the app already does by being the only thing on screen — so it's
 * intentionally minimal.
 */
public class AdKeralaDeviceAdminReceiver extends DeviceAdminReceiver {

    private static final String TAG = "AdKeralaDeviceAdmin";

    @Override
    public void onEnabled(Context context, Intent intent) {
        super.onEnabled(context, intent);
        Log.i(TAG, "device admin enabled");
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        super.onDisabled(context, intent);
        // Losing Device Owner mid-fleet-life means silent updates stop working on this specific
        // unit (falls back to needing someone to physically re-provision it) — surfaced in
        // logcat rather than crashing anything, since the display itself keeps working fine.
        Log.w(TAG, "device admin disabled — silent updates will stop working on this device");
    }
}
