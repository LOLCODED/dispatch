import { defineConfig } from '@playwright/test';
const port = Number(process.env.DISPATCH_E2E_PORT ?? 4318);
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 }, reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 }, browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 15000, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
});
