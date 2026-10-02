import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.integration.test.ts'], forbidOnly: Boolean(process.env.CI), fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } });
