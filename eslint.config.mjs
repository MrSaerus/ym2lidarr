// eslint.config.mjs
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    ignores: [
      'eslint.config.*',
      '**/node_modules/**',
      '**/dist/**',
      'apps/web/.next/**',
      'apps/web/out/**',
      'data/**',
      'prisma/data/**',
      '*.db',
      '*.db-*',
      'backups/**',
      'apps/pyproxy/**',
      'apps/api/__**',
      'apps/api/coverage/**',
      'apps/api/reports/**',
      'apps/api/jest.setup.ts',
      'apps/api/src/generated/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['apps/api/**/*.{ts,js}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],

      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021, process: 'readonly' },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
    settings: {
      next: {
        rootDir: 'apps/web/',
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,

      'no-unused-vars': 'off',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],

      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['**/*.config.{js,cjs,mjs}', 'apps/web/next.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
  },

  prettier,
]);