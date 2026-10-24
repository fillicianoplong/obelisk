import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// The sandboxed preload can require electron, not other application files.
// Bundle the bridge into the one script Electron loads.
export default defineConfig({
  build: {
    outDir: path.join(rootDir, 'dist/preload'),
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: path.join(rootDir, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron', 'fs'],
    },
  },
});
