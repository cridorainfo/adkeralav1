package com.adkerala.display;

import android.content.Context;
import android.util.Log;

import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

/**
 * Reflection bridge to Huidu's vendor "Toolbox" SDK (灰度主板API编程手册 / "Huidu mainboard API
 * programming manual" v1.13.0 — sent by Huidu support in response to a request for a
 * silent-upgrade mechanism for the fleet's Huidu-brand Android LED-display mainboards).
 *
 * Those boards ship with a privileged system app ("Toolbox") that already has root. toolkit.jar
 * exposes that root to a third-party app through a `HuiduTech` object — including a plain
 * `install(String apkPath)` silent-install call — without this app itself needing root, and
 * critically without needing the Device Owner enrollment AdKeralaUpdateChecker's
 * PackageInstaller path requires (see ANDROID-UPDATE.md). Device Owner enrollment is real field
 * friction (factory reset + "never add a Google account", per device); this class exists to
 * skip it entirely on hardware that has the Huidu SDK available, while leaving that path in
 * place unchanged for every device that doesn't (test phones, non-Huidu hardware).
 *
 * Reflection, not a compile-time `import`, on purpose: toolkit.jar is a file Huidu hands out
 * directly, not published anywhere this build could fetch it from, so it can't be checked into
 * this repo. A real `import cn.huidu....HuiduTech;` would only compile on a machine that
 * happens to have dropped the jar into libs/ first, breaking the build for everyone else.
 * Reflection means the app builds and runs identically with or without the jar present: drop
 * toolkit.jar into display/android/app/libs/ (build.gradle's `fileTree(include: ['*.jar'], dir:
 * 'libs')` already picks up anything there — no gradle changes needed) and this class starts
 * working. Leave it out and every lookup below fails once at startup, logs a single clear line,
 * and AdKeralaUpdateChecker falls back to its existing Device Owner path for that device.
 *
 * HUIDU_TECH_CLASS below is confirmed (not a guess) against the real
 * toolbox_kit_1.13.0_20250717.jar the user supplied — verified with `javap -p -classpath
 * toolkit.jar cn.huidu.toolkit.HuiduTech`, which also confirmed every method signature this
 * class calls (`install(String)`, `uninstall(String)`,
 * `setCompleteConnectionListener(HuiduTech$CompleteConnection)`, and the listener's own method,
 * `completeConnectionCallback(boolean)`). If a future SDK version ships under a different
 * package, re-run that same javap command against the new jar and update the constant below —
 * nothing else in this file needs to change.
 */
public final class HuiduSilentInstaller {

    private static final String TAG = "AdKeralaHuidu";

    /** Confirmed against toolkit.jar (toolbox_kit_1.13.0_20250717) — see class doc comment. */
    private static final String HUIDU_TECH_CLASS = "cn.huidu.toolkit.HuiduTech";

    private static volatile HuiduSilentInstaller instance;

    private final Object huiduTech; // instance of HUIDU_TECH_CLASS, or null if unavailable
    private final boolean available;
    private final Object connectionLock = new Object();
    private volatile boolean connected = false;
    private volatile boolean connectAttempted = false;

    private HuiduSilentInstaller(Context context) {
        Object tech = null;
        try {
            Class<?> cls = Class.forName(HUIDU_TECH_CLASS);
            tech = cls.getConstructor(Context.class).newInstance(context.getApplicationContext());
            Log.i(TAG, "toolkit.jar detected (" + HUIDU_TECH_CLASS + ") — Huidu silent-install path available");
        } catch (ClassNotFoundException e) {
            Log.i(TAG, "toolkit.jar not bundled in libs/ (or HUIDU_TECH_CLASS needs updating) — "
                + "Huidu silent-install path unavailable, AdKeralaUpdateChecker will use its "
                + "Device Owner / PackageInstaller path instead");
        } catch (Exception e) {
            Log.w(TAG, "toolkit.jar present but HuiduTech construction failed — Huidu silent-install "
                + "path unavailable this run", e);
        }
        this.huiduTech = tech;
        this.available = tech != null;
    }

    public static HuiduSilentInstaller getInstance(Context context) {
        if (instance == null) {
            synchronized (HuiduSilentInstaller.class) {
                if (instance == null) instance = new HuiduSilentInstaller(context);
            }
        }
        return instance;
    }

    /** True only once toolkit.jar is actually bundled and HuiduTech constructed successfully. */
    public boolean isAvailable() {
        return available;
    }

    /**
     * Waits briefly (once, ever) for the AIDL connection the manual describes
     * (setCompleteConnectionListener's callback fires "globally only once" per the manual) before
     * the first real call. Built with java.lang.reflect.Proxy since the listener is a
     * single-method functional interface we can't import by name. Fails open on timeout — a
     * slow/stuck AIDL handshake degrades this attempt back to "Huidu path unavailable right now",
     * never to blocking the updater indefinitely.
     */
    private void ensureConnected() {
        if (!available || connected) return;
        synchronized (connectionLock) {
            if (connected || connectAttempted) return;
            connectAttempted = true;
            try {
                Method setListener = findListenerSetter();
                if (setListener == null) {
                    Log.w(TAG, "no setCompleteConnectionListener-shaped method found on HuiduTech — "
                        + "proceeding without waiting for AIDL connect");
                    connected = true;
                    return;
                }
                Class<?> listenerType = setListener.getParameterTypes()[0];
                Object proxy = Proxy.newProxyInstance(
                    listenerType.getClassLoader(),
                    new Class<?>[]{listenerType},
                    (p, method, args) -> {
                        synchronized (connectionLock) {
                            connected = true;
                            connectionLock.notifyAll();
                        }
                        Log.i(TAG, "Huidu AIDL connection complete: "
                            + (args != null && args.length > 0 ? args[0] : "?"));
                        return null;
                    });
                setListener.invoke(huiduTech, proxy);
                connectionLock.wait(5000);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            } catch (Exception e) {
                Log.w(TAG, "setCompleteConnectionListener call failed — proceeding without waiting", e);
            }
            connected = true; // don't re-wait on every call even if the callback never fired
        }
    }

    private Method findListenerSetter() {
        for (Method m : huiduTech.getClass().getMethods()) {
            if (m.getName().equals("setCompleteConnectionListener") && m.getParameterTypes().length == 1) {
                return m;
            }
        }
        return null;
    }

    /**
     * boolean install(String apkPath) — silent install, no launch. Per the manual this has no
     * Toolbox-version caveat, unlike installAndStart (which the manual states does not work on
     * Toolbox 2.0+) — so this is the call AdKeralaUpdateChecker uses for the fleet's self-update,
     * regardless of which Toolbox generation a given board is running. Caller is responsible for
     * relaunching the app afterward.
     */
    public boolean install(String apkPath) {
        return invokeBooleanMethod("install", new Class<?>[]{String.class}, new Object[]{apkPath});
    }

    public boolean uninstall(String packageName) {
        return invokeBooleanMethod("uninstall", new Class<?>[]{String.class}, new Object[]{packageName});
    }

    private boolean invokeBooleanMethod(String name, Class<?>[] paramTypes, Object[] args) {
        if (!available) return false;
        ensureConnected();
        try {
            Method m = huiduTech.getClass().getMethod(name, paramTypes);
            Object result = m.invoke(huiduTech, args);
            return Boolean.TRUE.equals(result);
        } catch (Exception e) {
            Log.w(TAG, "HuiduTech." + name + "() failed", e);
            return false;
        }
    }
}
