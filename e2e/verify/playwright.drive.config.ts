import { defineConfig, devices } from '@playwright/test'

// Drive archive verification in a real browser against the REAL local edge runtime.
// Needs: `npx supabase start`, the fake Google running on :4545
//   (deno run -A e2e/verify/drive-fake-google-server.ts), and a production build of the app:
//   npx vite build --outDir /tmp/drive-dist ; DRIVE_DIST=/tmp/drive-dist
// The app is served at http://localhost:5173 by request interception (no server on that port),
// because APP_ORIGINS in supabase/functions/.env only allows that origin.
// Run: PW_CHROMIUM=/opt/pw-browsers/chromium DRIVE_DIST=... npx playwright test --config e2e/verify/playwright.drive.config.ts
const executablePath = process.env.PW_CHROMIUM || undefined

export default defineConfig({
  testDir: '.',
  testMatch: 'drive*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/drive-verify',
  use: {
    baseURL: 'http://localhost:5173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], serviceWorkers: 'block', launchOptions: { executablePath } } }],
})
