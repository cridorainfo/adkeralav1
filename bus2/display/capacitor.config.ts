import type { CapacitorConfig } from '@capacitor/cli';

// Local-server mode, not remote-server mode (contrast with cloud/web/android, which points
// at a live cloud URL). This app embeds the same local Node server the PC kiosk app runs
// (via nodejs-mobile-android — see MainActivity) so the display works fully offline, same as
// PC. `webDir: 'www'` is only a tiny loading splash bundled into the APK; MainActivity starts
// the embedded server, waits for it to answer, then navigates the WebView to
// http://127.0.0.1:<port>/display?kiosk=1&autofs=1 — the *embedded server* serves the real
// SPA (the same dist/ build already shared by the PC kiosk and driver app), not this webDir.
const config: CapacitorConfig = {
  appId: 'com.adkerala.display',
  appName: 'AdKerala Display',
  webDir: 'www',
  android: {
    allowMixedContent: true,
  },
};

export default config;
