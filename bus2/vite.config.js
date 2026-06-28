import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
