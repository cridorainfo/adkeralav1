# AdKerala Android Display — silent updates

Mirrors [PC-UPDATE.md](../PC-UPDATE.md)'s shape, but the mechanism is different: Android has no
equivalent of NSIS's silent installer, so a **zero-tap** install needs one of two things:

1. **Huidu vendor SDK** (see below) — on the fleet's Huidu-brand mainboards, works with **no
   per-device setup at all**. Tried first, whenever it's available.
2. **Device Owner** enrollment — an Android device-management status that can only be granted on
   a device with **no Google account ever added**. Real field friction: every device that isn't
   Huidu-capable (including casual test phones) needs this one-time setup *before* anyone signs
   into it. `AdKeralaUpdateChecker` falls back to this automatically whenever the Huidu path
   isn't available or fails.

---

## Huidu-board silent install (no Device Owner needed)

The fleet's Huidu-brand Android mainboards ship with a privileged, already-rooted system app
("Toolbox"). Huidu support provided `灰度主板API编程手册_1.13.0.docx` ("Huidu mainboard API
programming manual") in response to a request for a silent-upgrade mechanism — it documents a
`toolkit.jar` SDK exposing that root through a `HuiduTech` object, including a plain
`boolean install(String apkPath)` silent-install call third-party apps can use directly. That's
what [`HuiduSilentInstaller.java`](android/app/src/main/java/com/adkerala/display/HuiduSilentInstaller.java)
wraps, and it's what `AdKeralaUpdateChecker` tries **before** falling back to the Device Owner
path below.

- Uses `install(apkPath)`, not the manual's `installAndStart(apkPath, pkgName, activity)` —
  the manual states `installAndStart` does not work on Toolbox 2.0+, while `install` carries no
  such caveat, so this works uniformly across Toolbox generations. `AdKeralaUpdateChecker`
  relaunches the app itself afterward instead of relying on `installAndStart`'s built-in launch
  (see "Relaunch after silent install" below — this took two iterations to get reliable).
- Called via reflection, not a compile-time import — `toolkit.jar` is a proprietary file Huidu
  hands out directly (see [`android/app/libs/README.md`](android/app/libs/README.md)). Without
  it present, `HuiduSilentInstaller.isAvailable()` is simply `false` and this whole section is a
  no-op — the app builds and updates exactly as it did before this integration existed.

**Status**: `toolkit.jar` (delivered as `toolbox_kit_1.13.0_20250717.jar.zip`) is committed at
`android/app/libs/toolkit.jar` — picked up automatically by `build.gradle`'s
`fileTree(include: ['*.jar'], dir: 'libs')`, no gradle edit needed, and CI-built releases carry
it. `HuiduSilentInstaller.HUIDU_TECH_CLASS` (`cn.huidu.toolkit.HuiduTech`) has been verified
against this exact jar with `javap`, along with every method signature `HuiduSilentInstaller`
calls — see that class's doc comment. Confirmed working end-to-end on real field hardware
2026-08-11 (v1.0.24 → v1.0.25 installed with zero taps).

**Confirm it worked**: launch the app, `adb logcat -s AdKeralaHuidu` — should show
`toolkit.jar detected ... — Huidu silent-install path available` rather than the
"not bundled" line. `adb logcat -s AdKeralaUpdate` will then show `Huidu silent install
succeeded` instead of the PackageInstaller status lines on the next update.

### Relaunch after silent install

Getting the app to reliably come back to the *foreground* after killing its own process to load
the new APK's code turned out to be the hard part — silent install itself worked on the first
try, but relaunch didn't. Two things had to be layered on top of each other before it was
reliable:

1. **suExec-based restart** (`HuiduSilentInstaller.restartApp()`) — runs `am force-stop` + `am
   start -n` via the Toolbox's root shell (`suExec`), the same two commands proven reliable
   manually over `adb shell` on this hardware. This replaced an earlier AlarmManager-scheduled
   `PendingIntent` approach that a field test (2026-08-11, v1.0.26) caught landing on the home
   launcher instead of MainActivity — almost certainly Doze / background-activity-start deferral
   racing against the dying process, since `lastUpdateTime` confirmed the install itself had
   completed cleanly.
2. **AdKeralaPackageReplacedReceiver** (`MY_PACKAGE_REPLACED`) — a backstop that doesn't depend
   on the old, dying process at all. Android sends this broadcast to the app itself the moment
   *any* install mechanism replaces its APK (Huidu, Device Owner PackageInstaller, or a manual
   `adb install -r`), and — like `BOOT_COMPLETED` — it's exempted from Android 8+'s background-
   broadcast restrictions. This also quietly fixes a gap in the *original* Device Owner path,
   which never had an explicit relaunch step and was relying on an unverified assumption that
   Android would just handle it.

If a future device shows a successful `lastUpdateTime` but the wrong app in `mCurrentFocus`
(check both the same way as "Confirm it worked" above), this is the first place to look —
specifically whether `AdKeralaPkgReplaced` ever logged "package replaced — launching display" in
`adb logcat -s AdKeralaPkgReplaced`.

**v1.0.29 field case — the receiver logged but the screen still didn't come up**: a Huidu-path
device installed v1.0.29 cleanly (embedded server + update checker running, cloud showed it
"online" with a fresh `lastSeen`) but the physical screen sat on the Android home launcher. Root
cause: `AdKeralaPackageReplacedReceiver` was calling `Context.startActivity()` directly, which is
subject to Android's background-activity-start (BAL) restrictions — and this app is deliberately
*not* Device-Owner-enrolled on Huidu hardware, so it doesn't get the BAL exemption Device Owner
apps do. The call can silently no-op on exactly the hardware this whole Huidu path exists for.

Fixed by routing every relaunch trigger (post-install backstop, boot, and a new periodic
foreground watchdog — see below) through `AdKeralaRelaunch`, which prefers the same root suExec
`am start` `HuiduSilentInstaller.restartApp()` already uses, since a root shell start is never
subject to BAL restrictions. Plain `startActivity()` is now only the fallback for non-Huidu
devices, where the Device Owner BAL exemption already makes it reliable.

**Foreground watchdog**: `AdKeralaUpdateChecker` now also checks every 60s (via
`MainActivity.isForeground`, set from `onResume`/`onPause`) whether the Activity is actually on
screen, and forces a relaunch through `AdKeralaRelaunch` after two consecutive misses (~2 minutes)
regardless of cause — a relaunch race, a WebView crash, an ANR, anything. This is the self-healing
backstop for a kiosk display with no one in the field to notice or fix it manually.
`adb logcat -s AdKeralaUpdate` shows `MainActivity not in foreground` / `forcing relaunch` if this
ever fires.

---

## Per-device, one-time: enroll as Device Owner

Do this **before** setting up the device normally (before adding any Google account) — Android
refuses `dpm set-device-owner` once any account exists.

1. Factory-reset the device (Settings → System → Reset options → Erase all data), or start from
   a device that's never had an account added.
2. Go through Android's setup wizard, but **skip Wi-Fi/account sign-in** where possible, or at
   minimum don't add a Google account. (Wi-Fi is fine to connect for now if the wizard requires
   it — just skip the account step.)
3. Enable Developer Options (Settings → About → tap Build number 7×) → turn on **USB debugging**.
4. Connect the device to a computer with `adb`, confirm the RSA debugging prompt on the device.
5. Install the app (see build/share steps in the main chat history, or `adb install app-debug.apk`).
6. Run:
   ```bash
   adb shell dpm set-device-owner com.adkerala.display/.AdKeralaDeviceAdminReceiver
   ```
   Success looks like `Success: Admin set as active admin and device owner.` A failure here
   almost always means an account already exists on the device — go back to step 1.
7. Now safe to finish setup normally (add Wi-Fi, etc. — just never add a Google/Samsung/etc.
   account on this device, or Device Owner status is revoked).

**Confirm it worked**: launch the app, `adb logcat -s AdKeralaUpdate` — should **not** show the
`not enrolled as Device Owner` warning line.

**Un-enrolling** a device later (e.g. repurposing a test phone back to personal use):
```bash
adb shell dpm remove-active-admin com.adkerala.display/.AdKeralaDeviceAdminReceiver
```

---

## Shipping a new Android release

**Now automatic, same trigger as PC**: `npm run ship -- 1.2.0` tags and pushes, and
`.github/workflows/release.yml`'s `build-android` job builds, signs, publishes, and registers
the Android APK in the same run as the PC installer — one command ships both platforms with the
same version number. `display/android/app/build.gradle`'s `versionName`/`versionCode` are read
from the `ADKERALA_ANDROID_VERSION` env var CI sets from the git tag, not hand-edited per release
(local Android Studio builds without that env var fall back to a fixed dev version).

### One-time setup this needs (repo secrets)

Signing needs a real keystore — CI can't invent one, and every future release must reuse the
*same* keystore or Android will refuse to treat it as an update to what's already installed.

1. Generate a keystore once, if you don't already have one:
   ```bash
   keytool -genkeypair -v -keystore adkerala-display-release.jks \
     -alias adkerala-display -keyalg RSA -keysize 2048 -validity 10000
   ```
   Keep this file and its passwords somewhere safe outside the repo — losing it means you can
   never update previously-shipped installs again under the same app identity.
2. Add these as **repo secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `ANDROID_RELEASE_KEYSTORE_BASE64` | `base64 -w0 adkerala-display-release.jks` output |
   | `ANDROID_RELEASE_STORE_PASSWORD` | the keystore password |
   | `ANDROID_RELEASE_KEY_ALIAS` | `adkerala-display` (or whatever alias you used) |
   | `ANDROID_RELEASE_KEY_PASSWORD` | the key password |

   Also needs the same `ADKERALA_ADMIN_KEY` secret the PC pipeline already uses for cloud
   registration — nothing new there if PC releases already work.

Without these secrets, `build-android` still runs and produces an **unsigned** APK (uploaded and
registered like normal) — installable, but Android will refuse to install it as an *update* over
anything previously signed, and it won't silently self-update from that point on until re-signed
consistently. Set the secrets before the first real release.

### Manual/one-off build (skipping CI)

Still available if you need a build without pushing a tag — see the previous version of this doc
or just: bump `versionName`/`versionCode` in `build.gradle` (or set `ADKERALA_ANDROID_VERSION`
before invoking Gradle), `npm run build:display-bundle`, then Build APK(s) in Android Studio, then
`node scripts/register-android-release.mjs` by hand with wherever you uploaded it.

### After registering

- **Huidu-capable units** (`toolkit.jar` bundled, see above): check every 15 minutes (and once
  ~20s after boot), download, and install with **zero interaction and no enrollment step at
  all** — unless a trip is in progress, same deferral rule as below.
- **Enrolled (Device Owner) units**: same cadence, install with **zero interaction** — unless a
  trip is in progress (`tripStarted` and not `tripEnded` in local state), in which case they wait
  and recheck every minute until idle.
- **Force an immediate install regardless of trip state**: raise the minimum version in cloud
  admin → Releases → **Min Android version**. This is the Android equivalent of PC's
  "Push update to all buses now" button — there's no separate push endpoint for Android, the
  min-version escape hatch does the same job.
- **Neither Huidu-capable nor enrolled units** (Device Owner never set up, or lost, and no
  `toolkit.jar`): the app still checks and tries to install, but `PackageInstaller` falls back to
  requiring a confirmation tap it never gets shown to anyone, so nothing visibly happens.
  `adb logcat -s AdKeralaUpdate` will show `install requires user confirmation — this device is
  NOT enrolled as Device Owner` — that log line is the tell.

## Diagnosing a stuck update

```bash
adb logcat -s AdKeralaUpdate AdKeralaHuidu AdKeralaDisplay
```
Shows: check results (`up to date` / `installing update X`), download/checksum failures, trip-
deferral messages, whether the Huidu path is available (`AdKeralaHuidu`), and the install outcome
(`Huidu silent install succeeded` / `installed successfully` / the Device-Owner-missing message
above / any other `PackageInstaller` status code).
