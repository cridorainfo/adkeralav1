# One-time setup: libnode binaries

`display/android/app/CMakeLists.txt` and `build.gradle` reference `libnode/include` and
`libnode/bin/<abi>/libnode.so` — these are nodejs-mobile's prebuilt Node.js shared libraries.
They're a multi-hundred-MB binary release artifact, not source code, so they aren't committed to
this repo (same reason `node_modules/` and `dist/` aren't) — a build machine sets this up once.

## Steps

1. Download the nodejs-mobile Android release zip that matches the Node.js version this project
   otherwise targets (check the current release at
   https://github.com/nodejs-mobile/nodejs-mobile/releases — pick the `*-android.zip` asset).
2. Unzip it. It contains `include/` (Node's C headers) and `bin/<abi>/libnode.so` for each
   Android ABI. `android/app/build.gradle`'s `abiFilters` lists `armeabi-v7a`, `arm64-v8a`, and
   `x86_64` — the fleet spans multiple chipsets, not just arm64, so all three are required (`x86`
   32-bit stays excluded — no device this app ships on is 32-bit x86). Copy all three ABI
   folders. This does NOT rebuild the old ~152MB universal APK that bundled all three into one
   download — `build.gradle`'s `splits.abi` block builds one APK per ABI instead, so any given
   device still only downloads its own ~50-60MB, it just downloads the *correct* one for its own
   chipset now (see AdKeralaUpdateChecker.java's variant-matching and cloud/releases.js's
   per-ABI `variants` map for how a device picks the right one).
3. Copy them into this project so the paths line up with `CMakeLists.txt`:
   ```
   display/android/app/libnode/include/node/   <- the zip's include/ contents
   display/android/app/libnode/bin/armeabi-v7a/libnode.so
   display/android/app/libnode/bin/arm64-v8a/libnode.so
   display/android/app/libnode/bin/x86_64/libnode.so
   ```
4. `display/android/app/libnode/` should stay out of git (binary, platform-specific,
   redownloadable) — add it to `.gitignore` if it isn't already covered.

## Before every Android build

The embedded server itself (server code + dist/ + node_modules) is a separate bundle from
libnode — build it with:

```bash
cd bus2
npm run build:display-bundle
```

This runs `vite build` then `scripts/build-android-node-bundle.mjs`, which packages
`server/`, `shared/`, `cloud/shared/hub/`, and `dist/` into
`display/android/app/src/main/assets/nodejs-project/`, installing `express` + `selfsigned`
there via a fresh `npm install`. Run this before every `npx cap sync android` (from `display/`)
or Android Studio build — `AdKeralaNodeRunner` re-copies whatever's in that assets folder into
app-private storage on first run or after any app-version bump, and there's no dev-time
file-watcher wiring it up automatically yet.

## Why this can't just be a Gradle dependency

Unlike most Android libraries, nodejs-mobile-android doesn't publish to Maven Central or JitPack
as a ready-to-use AAR — its own getting-started docs point at a manual zip download + CMake
integration (the "native-gradle" pattern this project follows). A community Capacitor plugin
wrapping it (`capacitor-nodejs`) exists but only declares Capacitor 3/4 peer compatibility
against this project's Capacitor 8 — installing it here failed dependency resolution outright
(`ERESOLVE`), and forcing it through was judged too risky (its native Android glue is untested
against a Capacitor major version four releases newer than what it targets). The raw
native-gradle integration used here has no such version coupling — it talks to Capacitor's
WebView over plain HTTP, not through Capacitor's plugin bridge, so it doesn't care what
Capacitor version the rest of the app uses.
