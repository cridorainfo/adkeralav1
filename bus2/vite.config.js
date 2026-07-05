import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '#hub/lan': path.resolve(__dirname, 'cloud/shared/hub/lan.js'),
      '#hub/persist': path.resolve(__dirname, 'cloud/shared/hub/persist.js'),
      '#hub/api': path.resolve(__dirname, 'cloud/shared/hub/api.js'),
      '#hub/client': path.resolve(__dirname, 'cloud/shared/hub/client.js'),
      '#hub/drive': path.resolve(__dirname, 'cloud/shared/hub/drive.js'),
      '#hub/useHubState': path.resolve(__dirname, 'cloud/shared/hub/useHubState.js'),
    },
  },
  build: {
    rollupOptions: {
      external: ['@capacitor/browser'],
    },
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    strictPort: true,
    open: false,
  },
});
