import { defineConfig } from 'vite';

export default defineConfig({
  // root = project root (where index.html lives)
  publicDir: 'public',  // static assets served as-is (data/*.bin, data/*.json)
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ['maplibre-gl'],
  },
});
