import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**'] },
  {
    ...js.configs.recommended,
    files: ['src/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ['error', 'always'],
      'no-constant-condition': 'error',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        destructuredArrayIgnorePattern: '^_'
      }]
    }
  }
];
