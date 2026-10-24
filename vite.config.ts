import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, 'src/renderer'),
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, 'dist/renderer'),
    emptyOutDir: true,
  },
});
