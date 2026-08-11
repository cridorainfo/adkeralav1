import type { CapacitorConfig } from '@capacitor/cli';

// Deliberately its own applicationId, separate from com.adkerala.driver (cloud/web) and
// com.adkerala.display (display/) — this installs as a completely independent app. It can
// never update over, conflict with, or be mistaken for either real app on a test phone.
const config: CapacitorConfig = {
  appId: 'com.adkerala.gpstest',
  appName: 'AdKerala GPS Test',
  webDir: 'www',
};

export default config;
