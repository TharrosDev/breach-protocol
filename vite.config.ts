import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // next.html is the rebuild entry (phase 1 smoke test). index.html stays the same shell until cutover.
      input: { main: 'index.html', next: 'next.html' },
    },
  },
});
