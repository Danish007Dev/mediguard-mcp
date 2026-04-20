module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    jest: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint', 'jest'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:jest/recommended',
    'prettier'
  ],
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/'],
  overrides: [
    {
      files: ['tests/**/*.ts'],
      env: {
        jest: true,
        node: true
      }
    }
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      {
        prefer: 'type-imports'
      }
    ],
    'jest/no-disabled-tests': 'warn'
  }
};