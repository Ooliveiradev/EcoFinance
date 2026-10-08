import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/*.firebase.test.ts', '**/*.rollback.test.ts', '**/node_modules/**'],
    allowOnly: !process.env.CI,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['packages/shared/src/**/*.ts', 'apps/next/src/lib/import-parsers.ts', 'apps/next/src/lib/import-errors.ts', 'apps/next/src/lib/import-text.ts', 'apps/next/src/lib/import-values.ts', 'apps/next/src/lib/import-ofx.ts', 'apps/next/src/lib/import-delimited.ts', 'apps/next/src/lib/import-table.ts', 'apps/next/src/lib/import-zip.ts', 'apps/next/src/lib/import-spreadsheet.ts', 'apps/next/src/lib/access-policy.ts', 'apps/next/src/lib/cors.ts', 'apps/next/src/lib/request-body.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85, perFile: true },
    },
  },
});
