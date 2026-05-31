import { defineConfig, devices } from '@playwright/test';

process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',');
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5317',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5317 --strictPort',
    url: 'http://127.0.0.1:5317',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
