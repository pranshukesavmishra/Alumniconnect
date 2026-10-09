// Vitest config for the LinkedIn import verification tests in e2e/verify (kept out of the main `src/**` suite).
// Run: npx vitest run --config e2e/verify/linkedin.vitest.config.ts
// Extra files (e.g. a local dump script) can be added with LINKEDIN_EXTRA_TESTS=<glob>.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: new URL('../..', import.meta.url).pathname,
    environment: 'node',
    include: ['e2e/verify/linkedin*.test.ts', ...(process.env.LINKEDIN_EXTRA_TESTS ? [process.env.LINKEDIN_EXTRA_TESTS] : [])],
  },
})
