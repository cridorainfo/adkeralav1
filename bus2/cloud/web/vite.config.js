import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg'],
      manifest: {
        name: 'AdKerala Driver',
        short_name: 'Driver',
        description: 'Live GPS tracking and remote bus control for drivers',
        start_url: '/driver',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1419',
        theme_color: '#1a7f4b',
        categories: ['navigation', 'business'],
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@capacitor/preferences': path.resolve(__dirname, 'src/stubs/capacitor-preferences.js'),
      '#hub/lan': path.resolve(__dirname, '../shared/hub/lan.js'),
      '#hub/persist': path.resolve(__dirname, '../shared/hub/persist.js'),
      '#hub/api': path.resolve(__dirname, '../shared/hub/api.js'),
      '#hub/client': path.resolve(__dirname, '../shared/hub/client.js'),
      '#hub/driverConnectBoot': path.resolve(__dirname, '../shared/hub/driverConnectBoot.js'),
      '#hub/drive': path.resolve(__dirname, '../shared/hub/drive.js'),
      '#hub/useHubState': path.resolve(__dirname, '../shared/hub/useHubState.js'),
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 8788,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
