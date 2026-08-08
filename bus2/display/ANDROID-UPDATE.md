# AdKerala Android Display — silent updates

Mirrors [PC-UPDATE.md](../PC-UPDATE.md)'s shape, but the mechanism is different: Android has no
equivalent of NSIS's silent installer, so a **zero-tap** install requires the app to be enrolled
as **Device Owner** — an Android device-management status that can only be granted on a device
with **no Google account ever added**. That's the one real cost of the "silent everywhere"
choice: every device this app runs on, including casual test phones, needs this one-time setup
*before* anyone signs into it.

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

- **Enrolled (Device Owner) units**: check every 15 minutes (and once ~20s after boot), download,
  and install with **zero interaction** — unless a trip is in progress (`tripStarted` and not
  `tripEnded` in local state), in which case they wait and recheck every minute until idle.
- **Force an immediate install regardless of trip state**: raise the minimum version in cloud
  admin → Releases → **Min Android version**. This is the Android equivalent of PC's
  "Push update to all buses now" button — there's no separate push endpoint for Android, the
  min-version escape hatch does the same job.
- **Non-enrolled units** (Device Owner never set up, or lost): the app still checks and tries to
  install, but `PackageInstaller` falls back to requiring a confirmation tap it never gets shown
  to anyone, so nothing visibly happens. `adb logcat -s AdKeralaUpdate` will show
  `install requires user confirmation — this device is NOT enrolled as Device Owner` — that
  log line is the tell.

## Diagnosing a stuck update

```bash
adb logcat -s AdKeralaUpdate AdKeralaDisplay
```
Shows: check results (`up to date` / `installing update X`), download/checksum failures, trip-
deferral messages, and the install outcome (`installed successfully` / the Device-Owner-missing
message above / any other `PackageInstaller` status code).
