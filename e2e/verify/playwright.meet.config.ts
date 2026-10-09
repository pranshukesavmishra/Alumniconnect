import { defineConfig, devices } from '@playwright/test'

// Verification suite for the Alumni Meet (registration, payment, tickets, check-in, photos).
// Run: PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test --config e2e/verify/playwright.meet.config.ts
const executablePath = process.env.PW_CHROMIUM || undefined
const PORT = Number(process.env.MEET_PORT ?? 5182)

export default defineConfig({
  testDir: '.',
  testMatch: 'meet*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/meet-verify',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
