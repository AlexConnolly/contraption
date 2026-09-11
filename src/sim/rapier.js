// The browser gets the plain Rapier build, whose wasm is fetched as its own
// file. The `-compat` build inlines the same wasm as base64, which more than
// triples the bundle; tests still use it because Node loads it without flags.
import RAPIER from '@dimforge/rapier3d';

export default RAPIER;
