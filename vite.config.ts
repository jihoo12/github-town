import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the build works under GitHub Pages' /github-town/ path.
  base: './',
  build: {
    // three.js alone is ~600 kB minified; one chunk is fine for this app.
    chunkSizeWarningLimit: 900,
  },
});
