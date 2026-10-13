import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';
import { fileURLToPath } from 'node:url';

const nextRoot = fileURLToPath(new URL('./apps/next', import.meta.url));

export default tseslint.config(
  { ignores: ['.ci-diagnostics/**', '**/.claude/worktrees/**', '**/node_modules/**', '**/.next/**', '**/dist/**', '**/.expo/**', '**/android/**', '**/ios/**', '.local-postgres/**', 'packages/db/migration-drafts/**', '**/next-env.d.ts', '**/coverage/**', '**/playwright-report/**', '**/test-results/**'] },
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
    files: ['apps/next/src/**/*.{ts,tsx}', 'packages/shared/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.integration.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['postgres', 'postgres/*', 'pg', 'pg/*', 'drizzle-orm', 'drizzle-orm/*'], message: 'Runtime uses Firestore. SQL belongs only in reviewed offline migration/recovery tools (#34).' }] }],
    },
  },
  {
    files: ['apps/next/src/**/*.{ts,tsx}', 'apps/expo/src/**/*.{ts,tsx}'],
    ignores: ['apps/next/src/app/layout.tsx', '**/*.test.ts'],
    rules: {
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'Render untrusted content as text; introducing an HTML renderer requires a reviewed sanitizer policy (#33).' },
        { property: 'outerHTML', message: 'Render untrusted content as text (#33).' },
        { object: 'document', property: 'write', message: 'Document writes are not an allowed output context (#33).' }],
      'no-restricted-syntax': ['error', { selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]', message: 'Untrusted raw HTML is forbidden. The only exception is the static theme bootstrap in the root layout (#33).' }],
    },
  },
  {
    files: ['apps/next/**/*.{ts,tsx}'],
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
    },
  },
);
