import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Same-origin route to the Droid desktop bridge for both `vite` and `vite preview`:
 * set the bridge URL to `/bridge` and requests reach DROID_BRIDGE_URL without CORS.
 */
const bridgeProxy = {
  '/bridge': {
    target: process.env.DROID_BRIDGE_URL ?? 'http://127.0.0.1:3000',
    changeOrigin: true,
    rewrite: (/** @type {string} */ path) => path.replace(/^\/bridge/, ''),
  },
};

export default defineConfig({
  // Relative asset paths so the built index.html also loads from file:// inside Electron.
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
});
