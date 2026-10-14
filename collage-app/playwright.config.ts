import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/collage/',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'iphone-15-pro',
      use: { ...devices['iPhone 15 Pro'], browserName: 'chromium', defaultBrowserType: 'chromium' },
      testIgnore: /desktop\.spec\.ts/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /desktop\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/collage/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
