import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The new app is served at /next.html while production / keeps the legacy game (public/index.html).
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: { next: resolve(import.meta.dirname, 'next.html') },
    },
  },
});
