import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['packages/db/tests/*.rollback.test.ts'],fileParallelism:false,hookTimeout:60000,allowOnly:!process.env.CI}});
