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

/** Same-origin route to the optional local AI proxy (`npm run server`) for `vite` and `vite preview`. */
const aiProxy = {
  '/api/ai': { target: process.env.DROID_AI_PROXY_URL ?? 'http://127.0.0.1:3030', changeOrigin: true },
};

export default defineConfig({
  // Relative asset paths so the built index.html also loads from file:// inside Electron.
  base: './',
  plugins: [react()],
  server: { proxy: aiProxy },
  preview: { proxy: aiProxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
