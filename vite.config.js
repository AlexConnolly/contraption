import { defineConfig } from 'vite';

// A project page is served from /<repo>/, not from the root, so every asset URL
// has to carry that prefix. GitHub Actions puts "owner/repo" in the
// environment, which is the one place the name is known for certain — hard-
// coding it means renaming the repo silently breaks the site.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: repo ? `/${repo}/` : '/',
  server: {
    // Off deliberately. Editing a file mid-session otherwise reloads the page
    // and throws away whatever run or build was in progress, which makes the
    // game unplayable while anyone is working on it. Refresh to pick changes
    // up.
    hmr: false,
  },
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
