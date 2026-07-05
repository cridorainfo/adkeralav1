import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '#hub/persist': path.resolve(__dirname, 'shared/hub/persist.js'),
      '#hub/api': path.resolve(__dirname, 'shared/hub/api.js'),
      '#hub/client': path.resolve(__dirname, 'shared/hub/client.js'),
      '#hub/drive': path.resolve(__dirname, 'shared/hub/drive.js'),
      '#hub/useHubState': path.resolve(__dirname, 'shared/hub/useHubState.js'),
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
