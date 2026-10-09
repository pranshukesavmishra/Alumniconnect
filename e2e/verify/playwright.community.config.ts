import { defineConfig, devices } from '@playwright/test'

// Community verification suite (sign-in, onboarding, profiles, directory, feed, groups, connections,
// invites/vouches, notifications, birthdays, blocks/reports, PWA). Own Vite server on 5185.
//   PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test --config e2e/verify/playwright.community.config.ts
const executablePath = process.env.PW_CHROMIUM || undefined

export default defineConfig({
  testDir: '.',
  testMatch: /community.*\.spec\.ts/,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/community-verify',
  use: {
    baseURL: 'http://localhost:5185',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } }],
  webServer: {
    command: 'npx vite --port 5185 --strictPort',
    url: 'http://localhost:5185',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
