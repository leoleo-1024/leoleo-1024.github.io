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
    // テスト用フック（window.__editor）を含むビルドを、公開用の ../collage/ とは別の dist-e2e/ に出力して起動する
    command: 'npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    env: { VITE_E2E: '1' },
    url: 'http://localhost:4173/collage/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
