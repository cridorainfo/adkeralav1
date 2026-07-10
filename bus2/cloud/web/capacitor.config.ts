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
    url: 'https://adkerala.com/driver',
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
