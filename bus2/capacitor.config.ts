import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.adkerala.driver',
  appName: 'AdKerala Driver',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
