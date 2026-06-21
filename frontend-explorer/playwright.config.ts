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

// The e2e suite is written against the deterministic mock build (no node/RPC/indexer).
// Default to mock and only go live when a caller explicitly opts in (`test:e2e:live`).
// This is handed to `pnpm build && pnpm start` below so it wins over a local `.env.local`
// (which Next loads in production mode): `@next/env` never overrides an already-set
// process.env value, so an exported `NEXT_PUBLIC_DATA_SOURCE` takes precedence.
const DATA_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "mock";

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
      use: {
        ...devices["Desktop Chrome"],
        // Sandboxes without a Playwright-managed browser (e.g. ubuntu 26.04, where
        // `playwright install` is unsupported) can point at a system Chromium via
        // `PW_EXECUTABLE_PATH=/snap/bin/chromium`. Unset → default behaviour unchanged.
        ...(process.env.PW_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH, args: ["--no-sandbox", "--disable-setuid-sandbox"] } }
          : {}),
      },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    // Force the data source for the build+serve so e2e never picks up a local
    // `.env.local` (e.g. the live/devnet judging config). Mock unless overridden.
    env: { NEXT_PUBLIC_DATA_SOURCE: DATA_SOURCE },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
