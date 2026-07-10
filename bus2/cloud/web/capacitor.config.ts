import type { CapacitorConfig } from '@capacitor/cli';

// Remote-server mode: the app is a thin native shell around the live driver PWA.
// Updates deployed to the site (adkerala.com) take effect on next app open —
// no APK rebuild needed unless a native permission/plugin changes.
const config: CapacitorConfig = {
  appId: 'com.adkerala.driver',
  appName: 'AdKerala Driver',
  // Vite's outDir for this project is ../public (see vite.config.js) — only used as
  // the offline/fallback bundle Capacitor packages; server.url below is what actually loads.
  webDir: '../public',
  server: {
    // GPS-test build: opens straight into the code-entry link flow (no QR/camera,
    // no bus Wi-Fi). Point back to '/driver' once this becomes the real driver app.
    url: 'https://adkerala.com/driver/gps-test',
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
