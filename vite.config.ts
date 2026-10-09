import { defineConfig } from 'vite';

// The new game is the root entry (index.html). The legacy single-file game is served unchanged at /legacy/.
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
