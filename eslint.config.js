import js from '@eslint/js';

/**
 * This exists for one rule: no-undef.
 *
 * A missing import is not a syntax error and not a type error. The bundler
 * happily emits a reference to a name that is not there, the tests pass
 * because nothing loads the entry point, and the first thing that finds out is
 * somebody opening the site. That happened, so it is checked now.
 */
export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        Image: 'readonly',
        Audio: 'readonly',
        AudioContext: 'readonly',
        webkitAudioContext: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        addEventListener: 'readonly',
        removeEventListener: 'readonly',
        dispatchEvent: 'readonly',
        KeyboardEvent: 'readonly',
        PointerEvent: 'readonly',
        Event: 'readonly',
        console: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        Buffer: 'readonly',
        Blob: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        CompressionStream: 'readonly',
        DecompressionStream: 'readonly',
        devicePixelRatio: 'readonly',
        innerWidth: 'readonly',
        innerHeight: 'readonly',
        prompt: 'readonly',
        globalThis: 'readonly',
        process: 'readonly',
        Float32Array: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
      },
    },
    rules: {
      // The one that matters. Everything else stays off: this is a guard, not
      // a style argument.
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
];
