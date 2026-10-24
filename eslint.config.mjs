import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import {
  rendererImportBanMessage,
  rendererImportBanRegexSource,
  rendererRequireSelectors,
} from './scripts/renderer-import-ban.mjs';

const unusedVars = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'docs/**', 'coverage/**'],
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
    files: ['src/**/*.ts', 'src/**/*.tsx', 'vite.config.mts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', unusedVars],
    },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    rules: {
      // NFR-22: the renderer reaches the disk only through the typed IPC bridge.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: rendererImportBanRegexSource(),
              caseSensitive: true,
              message: rendererImportBanMessage,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...rendererRequireSelectors().map((selector) => ({
          selector,
          message: rendererImportBanMessage,
        })),
      ],
    },
  },
);
