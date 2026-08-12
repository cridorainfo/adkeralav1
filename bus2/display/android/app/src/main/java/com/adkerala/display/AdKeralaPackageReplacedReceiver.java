package com.adkerala.display;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Relaunches the display the moment Android itself reports this app's own APK was replaced —
 * fires regardless of which install mechanism did the replacing (Huidu's HuiduTech.install(),
 * the Device Owner PackageInstaller path, or a manual `adb install -r`), and independently of
 * whether the OLD process (the one that triggered the update) survives long enough to run its
 * own relaunch code. MY_PACKAGE_REPLACED, like BOOT_COMPLETED, is exempted from Android 8+'s
 * general implicit-broadcast background restrictions specifically for this purpose.
 *
 * This exists because AdKeralaUpdateChecker's own relaunch attempt (HuiduSilentInstaller's
 * suExec-based `am force-stop` + `am start`) is fired from a process that's about to die, which
 * is inherently a race — a field case (2026-08-11, v1.0.26) showed the *previous*, weaker
 * AlarmManager-based approach losing that race and landing on the home launcher instead of
 * MainActivity, after an otherwise fully successful silent Huidu install. This receiver is the
 * reliable backstop: even if the in-process relaunch attempt loses its race (or Huidu isn't
 * available at all, e.g. the Device Owner PackageInstaller path, which never had an explicit
 * relaunch step), this still fires once the freshly-installed APK's own receivers are live.
 *
 * Relaunches via AdKeralaRelaunch (root suExec `am start` when Huidu is available), not a plain
 * Context.startActivity() call — a v1.0.29 field case showed exactly this receiver's *previous*
 * plain-startActivity version firing (logged "package replaced — launching display") while the
 * screen still sat on the home launcher: the embedded server + update checker kept running and
 * reporting "online" to cloud, which only happens from inside MainActivity.onCreate(), yet the
 * Activity itself never actually came to the foreground — the signature of a startActivity()
 * call from a BroadcastReceiver silently losing to Android's background-activity-start
 * restriction on this non-Device-Owner-enrolled hardware. See AdKeralaRelaunch's doc comment.
 */
public class AdKeralaPackageReplacedReceiver extends BroadcastReceiver {

    private static final String TAG = "AdKeralaPkgReplaced";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        Log.i(TAG, "package replaced — launching display");
        AdKeralaRelaunch.bringToForeground(context, "package replaced");
    }
}
