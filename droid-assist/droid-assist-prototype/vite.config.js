import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the built index.html also loads from file:// inside Electron.
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
});
