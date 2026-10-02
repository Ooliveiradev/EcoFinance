import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    allowOnly: !process.env.CI,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['packages/shared/src/**/*.ts', 'apps/next/src/lib/ofx-parser.ts', 'apps/next/src/lib/session.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85, perFile: true },
    },
  },
});
