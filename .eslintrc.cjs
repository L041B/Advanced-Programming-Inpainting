module.exports = {
  // This specifies the parser ESLint should use.
  // '@typescript-eslint/parser' is the parser that allows ESLint to understand TypeScript syntax.
  parser: '@typescript-eslint/parser',

  // Options specific to the parser.
  parserOptions: {
    ecmaVersion: 2020, // Allows the use of modern ECMAScript features
    sourceType: 'module', // Allows the use of 'import'
    // Remove the `project` option to avoid parsing errors on config files not included in the TSConfig.
  },

  // The plugins that ESLint should use.
  // `@typescript-eslint` contains all the rules specific to TypeScript.
  plugins: ['@typescript-eslint'],

  // Extends default configurations. This is the easiest way to get started.
  extends: [
    // Recommended base rules from ESLint
    'eslint:recommended',

    // Recommended rules from the TypeScript-ESLint plugin.
    // Disables ESLint's base rules that conflict with TypeScript.
    'plugin:@typescript-eslint/recommended',

    // 'plugin:@typescript-eslint/recommended-requiring-type-checking'
  ],

  // Specifies that this is the main configuration file.
  // ESLint will stop looking for configuration files in parent folders.
  root: true,

  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],

    '@typescript-eslint/no-var-requires': 'off',

    '@typescript-eslint/no-explicit-any': 'warn',
  },
};