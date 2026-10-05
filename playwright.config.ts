import { defineConfig, devices } from '@playwright/test';
import { TEST_AUTH_SECRET } from './tests/e2e/credentials';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-web', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm --filter @ecofinance/next start --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: false,
    timeout: 120000,
    env: { AUTH_SECRET: TEST_AUTH_SECRET, AUTH_URL: 'http://127.0.0.1:3000', DATABASE_URL: process.env.TEST_E2E_DATABASE_URL ?? '', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
