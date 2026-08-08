package com.adkerala.display;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Auto-launches the display on device boot, same "always-on kiosk" behavior as the PC app
 * (Electron starts the kiosk window on Windows login). Listens for both the standard
 * BOOT_COMPLETED and the older QUICKBOOT_POWERON some Android TV box OEM firmwares fire instead
 * of/alongside it (a common quirk on the cheap Amlogic-based boxes this app targets).
 *
 * Caveat that can't be coded around: Android withholds BOOT_COMPLETED from an app that's been
 * installed but never actually opened (a "stopped" app) — this receiver only starts firing from
 * the *second* boot onward after the very first manual launch. See ANDROID-UPDATE.md.
 */
public class AdKeralaBootReceiver extends BroadcastReceiver {

    private static final String TAG = "AdKeralaBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        Log.i(TAG, "boot completed — launching display (" + action + ")");
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launch);
    }
}
