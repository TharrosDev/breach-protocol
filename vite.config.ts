import { defineConfig } from 'vite';

// The new game is the root entry (index.html). The legacy single-file game is served unchanged at /legacy/.
export default defineConfig({
  server: {
    // The dev server watches the project folder. Build output and test artefacts change constantly during a test run
    // and would trigger pointless reloads and file-system work.
    watch: { ignored: ['**/dist/**', '**/test-results/**', '**/playwright-report/**', '**/docs/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: process.env.SOURCEMAP === '1',
    // Skips the gzip size pass over every output file, which costs build time and CPU for a number nobody reads here.
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Three.js is its own long-cached chunk, and the post-processing modules (loaded on demand for High quality)
        // are another, so a Low-quality player never downloads them. The match code itself is a dynamic import (see
        // app/shell.ts), so the menu loads without Three.js at all.
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules/three/')) return undefined;
          if (
            id.includes('/examples/jsm/postprocessing/') ||
            id.includes('/examples/jsm/environments/') ||
            id.includes('/examples/jsm/shaders/')
          ) {
            return 'three-post';
          }
          return 'three';
        },
      },
    },
  },
});
