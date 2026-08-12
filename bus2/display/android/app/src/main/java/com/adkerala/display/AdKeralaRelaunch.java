package com.adkerala.display;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Single place that knows how to bring MainActivity back to the foreground — used by every
 * "something may have knocked the display off-screen" trigger: a fresh silent install
 * (AdKeralaPackageReplacedReceiver), boot (AdKeralaBootReceiver), and the periodic foreground
 * watchdog (AdKeralaUpdateChecker).
 *
 * Root suExec `am start` (via HuiduSilentInstaller, on the Huidu-brand boards this fleet uses)
 * is preferred wherever available. This is not a style preference: a plain
 * Context.startActivity() call from a BroadcastReceiver or background thread is subject to
 * Android's background-activity-start (BAL) restrictions, and this app is deliberately NOT
 * Device-Owner-enrolled on Huidu hardware (that's the entire point of the Huidu silent-install
 * path — see HuiduSilentInstaller's doc comment) — so it doesn't get the BAL exemption Device
 * Owner apps do. A root shell `am start`, by contrast, comes from a privileged UID and is never
 * subject to that restriction, which is why it's the one relaunch path proven not to silently
 * no-op. Field case 2026-08-11 (v1.0.26 → v1.0.29): a display was confirmed to have installed an
 * update and kept its embedded server + update checker running (still reporting "online" to
 * cloud) while the visible screen sat on the Android home launcher — i.e. exactly the failure
 * mode of a relaunch call that silently didn't bring the Activity to the foreground. See
 * ANDROID-UPDATE.md's "Relaunch after silent install" section for the fuller history.
 *
 * Falls back to plain startActivity() only when Huidu isn't available at all — the same class of
 * devices that must be Device Owner-enrolled to update silently in the first place, where the
 * BAL exemption Device Owner grants already covers this call.
 */
final class AdKeralaRelaunch {
    private static final String TAG = "AdKeralaRelaunch";

    private AdKeralaRelaunch() {}

    static void bringToForeground(Context context, String reason) {
        HuiduSilentInstaller huidu = HuiduSilentInstaller.getInstance(context);
        if (huidu.isAvailable() && huidu.restartApp(context.getPackageName(), ".MainActivity")) {
            Log.i(TAG, reason + " — relaunched via Huidu root am start");
            return;
        }
        Log.i(TAG, reason + " — Huidu restart unavailable or failed, falling back to startActivity "
            + "(reliable only on Device-Owner-enrolled devices; see class doc comment)");
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launch);
    }
}
