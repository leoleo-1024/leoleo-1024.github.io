import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174/blur/',
    trace: 'off',
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
    // テスト用フック（window.__app）を含むビルドを、公開用の ../blur/ とは別の dist-e2e/ に出力して起動する
    command: 'npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4174 --strictPort',
    env: { VITE_E2E: '1' },
    url: 'http://localhost:4174/blur/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
