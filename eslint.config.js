// Static gate for the one class of bug the bundler never reports: an identifier that is used but
// never imported or declared (Vite bundles it, the browser throws ReferenceError at startup).
// Only no-undef is enabled on purpose: style stays with scripts/check-policy.mjs.
import globals from 'globals';

const common = {
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: { 'no-undef': 'error' },
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/pages/**', 'src/components/**', 'src/lib/**'] },
  { ...common, files: ['src/client/**/*.js'], languageOptions: { ...common.languageOptions, globals: globals.browser } },
  {
    ...common,
    files: ['src/server/**/*.js', 'src/shared/**/*.js', 'base44/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.js'],
    languageOptions: { ...common.languageOptions, globals: { ...globals.node, ...globals.browser } },
  },
];
