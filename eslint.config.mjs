import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';
import { fileURLToPath } from 'node:url';

const nextRoot = fileURLToPath(new URL('./apps/next', import.meta.url));

export default tseslint.config(
  { ignores: ['.ci-diagnostics/**', '**/node_modules/**', '**/.next/**', '**/dist/**', '**/.expo/**', '**/android/**', '**/ios/**', 'gas/**', '.local-postgres/**', 'packages/db/migration-drafts/**', '**/next-env.d.ts', '**/coverage/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { '@next/next': next },
    settings: { next: { rootDir: nextRoot } },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Legacy SDK callbacks are incrementally typed as their flows are replaced.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/next/**/*.{ts,tsx}'],
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
    },
  },
);
