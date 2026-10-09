import { defineConfig, devices } from '@playwright/test'

// LinkedIn import verification (e2e/verify/linkedin*.spec.ts) against a local Supabase and a Vite dev server on :5181.
// PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test --config e2e/verify/playwright.linkedin.config.ts
// Optional: LINKEDIN_SAMPLES=/dir/of/real/linkedin/pdfs (never committed) adds the real-PDF round trip test.
const executablePath = process.env.PW_CHROMIUM || undefined

export default defineConfig({
  testDir: '.',
  testMatch: 'linkedin*.spec.ts',
  outputDir: '../../test-results/linkedin',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5181',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } }],
  webServer: {
    command: 'npx vite --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
