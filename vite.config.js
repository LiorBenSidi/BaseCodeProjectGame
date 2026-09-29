import { defineConfig } from 'vite';

// index.html lives at the repo root, so the default root is correct.
// The dev server is started by src/server/server.js in middleware mode (one port for game + assets).
export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: false, // do not ship source maps to players in production builds
    target: 'es2022',
  },
});
