import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, 'src/renderer'),
  base: './',
  // assets/fonts is copied to dist/renderer/fonts. The page loads Liberation Serif from there.
  publicDir: path.join(rootDir, 'assets'),
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, 'dist/renderer'),
    emptyOutDir: true,
  },
});
