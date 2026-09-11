import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // Rapier's wasm-bindgen glue must not be pre-bundled: the optimiser makes
    // a second copy of it, and only one of the two ends up holding the wasm
    // memory views, so every call through the other one fails.
    exclude: ['@dimforge/rapier3d'],
  },
  build: {
    // The wasm ships as its own file and Three.js rarely changes, so both are
    // worth splitting out and caching separately from the game code.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
});
