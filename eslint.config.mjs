// eslint.config.mjs — flat config for ESLint v9+
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
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
      'apps/api/jest.setup.ts'
    ],
  },

  js.configs.recommended,

  // API (Node/TS)
  ...tseslint.config({
    files: ['apps/api/**/*.{ts,js}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./apps/api/tsconfig.json'],
        tsconfigRootDir: new URL('.', import.meta.url),
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
    plugins: { import: importPlugin, '@typescript-eslint': tseslint.plugin },
    settings: {
      'import/resolver': {
        typescript: { project: ['./tsconfig.base.json', './apps/*/tsconfig.json'] },
      },
    },
    rules: {
      'no-console': 'off',
      'import/order': 'off',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  }),

  // Web (Next/TSX)
  ...tseslint.config({
    files: ['apps/web/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./apps/web/tsconfig.json'],
        tsconfigRootDir: new URL('.', import.meta.url),
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      // браузерные глобалы + process (Next вырезает при билде)
      globals: { ...globals.browser, ...globals.es2021, process: 'readonly' },
    },
    plugins: {
      import: importPlugin,
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    settings: {
      'import/resolver': {
        typescript: { project: ['./tsconfig.base.json', './apps/*/tsconfig.json'] },
      },
    },
    rules: {
      'no-console': 'off',
      'import/order': 'off',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  }),

  // Node-глобалы для конфигов (next.config.js и т.п.)
  {
    files: ['**/*.config.{js,cjs,mjs}', 'apps/web/next.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {},
  },

  // совместимость с Prettier
  prettier,
];
