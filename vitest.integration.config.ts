import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/next/src', import.meta.url)) } },
  test: {
    include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts', 'packages/db/src/migrations.test.ts'],
    allowOnly: !process.env.CI,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/integration',
      include: ['packages/db/src/migrations.ts'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85, perFile: true },
    },
  },
});
