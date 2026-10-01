import js from '@eslint/js';

const nodeGlobals = Object.fromEntries([
  'AbortController', 'AbortSignal', 'Buffer', '__dirname', 'clearInterval', 'clearTimeout', 'console', 'exports', 'fetch',
  'global', 'module', 'performance', 'process', 'queueMicrotask', 'require',
  'setImmediate', 'setInterval', 'setTimeout', 'URL', 'URLSearchParams'
].map(name => [name, 'readonly']));

const jestGlobals = Object.fromEntries([
  'afterAll', 'afterEach', 'beforeAll', 'beforeEach', 'describe', 'expect',
  'fail', 'it', 'jest', 'test'
].map(name => [name, 'readonly']));

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  {
    files: ['*.js', '*.mjs', 'lib/**/*.js', 'examples/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      'preserve-caught-error': 'off'
    }
  },
  {
    files: ['*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { sourceType: 'module' }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: jestGlobals }
  },
  {
    files: ['lib/workbench/*.js', 'examples/metrics/ui.js'],
    languageOptions: { sourceType: 'module', globals: {
      Blob: 'readonly', document: 'readonly', fetch: 'readonly', console: 'readonly'
    } }
  }
];
