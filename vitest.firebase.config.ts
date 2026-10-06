import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve:{alias:{'@':fileURLToPath(new URL('./apps/next/src',import.meta.url))}},
  test:{include:['packages/**/*.firebase.test.ts','apps/next/src/lib/auth.integration.test.ts'],fileParallelism:false,testTimeout:30000,hookTimeout:60000,allowOnly:!process.env.CI},
});
