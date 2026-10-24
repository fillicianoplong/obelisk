import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const unusedVars = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'docs/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', unusedVars],
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'vite.config.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', unusedVars],
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'The renderer cannot import Electron APIs.',
            },
            {
              name: 'fs',
              message: 'The renderer cannot import Node APIs.',
            },
            {
              name: 'path',
              message: 'The renderer cannot import Node APIs.',
            },
            {
              name: 'child_process',
              message: 'The renderer cannot import Node APIs.',
            },
            {
              name: 'os',
              message: 'The renderer cannot import Node APIs.',
            },
          ],
          patterns: [
            {
              group: ['node:*', 'electron/*'],
              message: 'The renderer cannot import Node or Electron main APIs.',
            },
          ],
        },
      ],
    },
  },
);
