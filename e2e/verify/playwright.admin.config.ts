import { defineConfig, devices } from '@playwright/test'

// Admin / roles / security verification suite. Runs against the local Supabase and its own Vite server (5183).
//   PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test --config e2e/verify/playwright.admin.config.ts
const executablePath = process.env.PW_CHROMIUM || undefined

export default defineConfig({
  testDir: '.',
  testMatch: /admin.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/admin-verify',
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } }],
  webServer: {
    command: 'npx vite --port 5183 --strictPort',
    url: 'http://localhost:5183',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
