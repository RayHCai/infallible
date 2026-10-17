import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port and must see Rust errors (clearScreen: false).
// https://v2.tauri.app/start/frontend/vite/
const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 1420,
    strictPort: true,
    ...(host ? { host, hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: process.env['TAURI_ENV_PLATFORM'] === 'windows' ? 'chrome105' : 'safari15',
    minify: process.env['TAURI_ENV_DEBUG'] ? false : 'oxc',
    sourcemap: Boolean(process.env['TAURI_ENV_DEBUG']),
    // three.js alone is ~600 kB; the bundle is loaded from disk by Tauri, not the network.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
  },
});
