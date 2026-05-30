import globals from 'globals';

// Flat config for a no-build, vanilla-JS project.
// Frontend (public/js) loads via <script> tags into one shared global scope —
// so `no-undef` is off there (cross-file globals would be all false positives).
// The highest-value signal here is parse/syntax errors (always reported) plus
// unused locals and unreachable code.
export default [
  {
    ignores: [
      'node_modules/**', 'data/**', 'logs/**', 'finals/**', 'archive/**',
      'characters/**', 'environments/**', 'details/**', 'refs/**', 'obrazy/**',
      'lookbooks/**', 'uploads/**', 'scenes/**', 'temp_files/**', 'temp_public/**',
      'hooks/**',
    ],
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
      'no-unreachable': 'warn',
      'no-dupe-keys': 'warn',
      'no-dupe-args': 'warn',
      'no-func-assign': 'warn',
      'no-cond-assign': 'warn',
    },
  },
  {
    files: ['server.js', 'launcher.js', 'routes/**/*.js', 'lib/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'warn',
      'no-unreachable': 'warn',
    },
  },
];
