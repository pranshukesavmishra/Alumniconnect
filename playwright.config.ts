import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against a local Supabase (`npx supabase start`) and the Vite dev server.
// In this repo's cloud dev container, Chromium is pre-installed: PW_CHROMIUM=/opt/pw-browsers/chromium
const executablePath = process.env.PW_CHROMIUM || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
