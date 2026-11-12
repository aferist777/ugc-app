import globals from 'globals';

// Flat config for a no-build, vanilla-JS project.
// The pages (public/js) are ES modules, apart from the classic scripts loaded with a plain <script>
// tag (Admin's four and storage-sync.js). `no-undef` is off there: a page's modules share state through window, and those
// globals would all be false positives. The highest-value signal is parse/syntax errors (always
// reported) plus unused locals and unreachable code. An unused `catch (e)` is not reported: the
// app's catches name their error by habit.
const PAGE_RULES = {
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-undef': 'off',
  'no-unreachable': 'warn',
  'no-dupe-keys': 'warn',
  'no-dupe-args': 'warn',
  'no-func-assign': 'warn',
  'no-cond-assign': 'warn',
};

export default [
  {
    ignores: ['node_modules/**', 'vendor/**', 'local-data/**', 'library/**'],
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: PAGE_RULES,
  },
  {
    files: ['public/js/admin-ai.js', 'public/js/admin-keys.js', 'public/js/admin-local.js', 'public/js/admin-thanks.js',
      'public/js/storage-sync.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['server.js', 'desktop/**/*.js', 'routes/**/*.js', 'lib/**/*.js', 'tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      'no-unreachable': 'warn',
      // The desktop window has no console, so on Windows a console program started without
      // windowsHide opens a console window of its own - one flashing up for every ffmpeg run.
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name=/^(spawn|spawnSync|execFile|execFileSync|execSync)$/]:not(:has(Property[key.name='windowsHide']))",
        message: 'Pass windowsHide: true (see eslint.config.mjs).',
      }, {
        selector: "CallExpression[callee.property.name=/^(spawn|spawnSync|execFile|execFileSync|execSync)$/]:not(:has(Property[key.name='windowsHide']))",
        message: 'Pass windowsHide: true (see eslint.config.mjs).',
      }],
    },
  },
];
