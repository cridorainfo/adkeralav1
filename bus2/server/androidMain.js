import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startBusServer } from './prod.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Boot entry for the embedded Node runtime on Android display units, run via nodejs-mobile's
 * raw native-gradle integration (see display/android/app/src/main/cpp/native-lib.cpp +
 * AdKeralaNodeRunner.java) — a real `node::Start()` call, not a Capacitor plugin bridge; the
 * only interface between this process and the WebView is plain HTTP, same as Electron's kiosk.
 * Mirrors what kiosk/main.cjs does for the Electron kiosk app — start the same local server,
 * then the native shell (MainActivity, via WebView instead of BrowserWindow) navigates to
 * /display?kiosk=1&autofs=1 once it answers (MainActivity polls the port itself, waitForServer-
 * style — there is no message-channel API in the raw nodejs-mobile library to signal readiness).
 *
 * nodejs-mobile embeds Node in-process — no fork(), no second OS process, no npm/git available —
 * so anything in server/*.js that assumes a real OS child process must be disabled here rather
 * than relying on kiosk/main.cjs's PC defaults:
 *   - server/localAdmin.js's embedded cloud-admin path (spawns `npm install` + `node server.js`)
 *     — disabled below by always setting ADKERALA_CLOUD_URL + ADKERALA_LOCAL_ADMIN=0.
 *   - kiosk/hotpatchSupervisor.cjs's fork-based self-test hot-patch mechanism — not used on
 *     Android at all; this file never imports it. Android's own update check/install is entirely
 *     native (see AdKeralaUpdateChecker.java) — the embedded server bundle here isn't itself
 *     separately update-checked, it just ships bundled with whatever APK version is installed.
 * Everything else server/prod.js pulls in (dbApi, hubSessions, networkInfo, cloudSync,
 * cloudProxy, driveApi, tls/selfsigned) is plain JS with no native bindings and runs unmodified.
 *
 * AdKeralaNodeRunner.java writes a small JSON config to a known path *before* starting this Node
 * process and passes that path as argv[2] — this avoids depending on nodejs-mobile's own env-var
 * injection, which isn't stable across its versions.
 */

function readAndroidConfig() {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error(
      'androidMain.js requires a config file path as argv[2] — written by ' +
        'AdKeralaNodeService before starting the embedded Node process.'
    );
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  if (!config.dataRoot) throw new Error('android config missing dataRoot');
  if (!config.cloudUrl) throw new Error('android config missing cloudUrl');
  return config;
}

const config = readAndroidConfig();

// server/getAppRoot.js resolves the code root (dist/, server/) from ADKERALA_ROOT — this file's
// own directory's parent, i.e. wherever nodejs-mobile extracted the bundled nodejs-project/
// assets. The *writable* data root (db/, media, hub sessions) must live outside that tree:
// nodejs-mobile can re-extract/replace the bundled project assets on an app update, which would
// wipe anything stored alongside the code instead of in app-private storage proper.
process.env.ADKERALA_ROOT = path.join(__dirname, '..');
process.env.ADKERALA_DATA_ROOT = config.dataRoot;
process.env.ADKERALA_LOCAL_ADMIN = '0';
process.env.ADKERALA_CLOUD_URL = config.cloudUrl;
process.env.ADKERALA_PLATFORM = 'android';
// The real installed APK version (PackageInfo.versionName, read natively — see
// AdKeralaNodeRunner.java) — see server/version.js's own comment for why this can't just be
// this bundle's own package.json version.
if (config.appVersion) process.env.ADKERALA_APP_VERSION_OVERRIDE = String(config.appVersion);

const PORT = Number(config.port ?? process.env.PORT ?? 5174);

fs.mkdirSync(config.dataRoot, { recursive: true });

// host: '0.0.0.0' (not '127.0.0.1') — matches server/prod.js's own PC default. Loopback-only
// would make the WebView's own 127.0.0.1 fetches work while refusing every LAN connection from
// a driver phone (exactly ERR_CONNECTION_REFUSED against the LAN IP the QR code shows) — the
// whole point of Phase 2's driver-pairing checkpoint is that a *second* device reaches this one.
startBusServer({ port: PORT, host: '0.0.0.0', dataRoot: config.dataRoot })
  .then((server) => {
    // Readiness is discovered by MainActivity polling this port over plain HTTP (see
    // waitForServer() there, mirroring kiosk/main.cjs) — logged here only for adb logcat.
    console.log(`AdKerala Android display server listening on ${server.urls.displayUrl}`);
  })
  .catch((err) => {
    console.error('AdKerala Android display server failed to start:', err);
  });
