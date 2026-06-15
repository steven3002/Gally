import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e config (FE-M1 test harness / FE-M2 navigation + link-crawl).
 *
 * The explorer is fully static/mock-backed (no live I/O before FE-M8), so we run
 * the production build (`next build && next start`) — it pre-renders the routes
 * the crawl visits and avoids the dev error-overlay. `reuseExistingServer` lets a
 * pre-started `pnpm start` be reused locally so iterating on specs is fast.
 */
const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
