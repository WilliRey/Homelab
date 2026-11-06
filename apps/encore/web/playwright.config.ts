import { defineConfig, devices } from '@playwright/test';

// Mobile-viewport smoke tests. Both projects run on Chromium (with touch and the
// devices' viewports/UAs); real iOS Safari behaviour is checked on a phone (PLAN.md §11).
// PW_CHROMIUM_PATH lets a machine with a preinstalled Chromium skip `playwright install`.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const launchOptions = { executablePath, args: ['--autoplay-policy=no-user-gesture-required'] };

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'off' },
  projects: [
    { name: 'iPhone 15', use: { ...devices['iPhone 15'], browserName: 'chromium', defaultBrowserType: 'chromium', launchOptions } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'], browserName: 'chromium', launchOptions } },
  ],
  webServer: {
    command: 'npm --prefix ../server run e2e:server',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
