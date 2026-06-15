import { test, expect } from "@playwright/test";

// FE-M2 defining test: the explorer is a traversable graph, so every internal
// link reachable from a top-level page must resolve to a real route — no 404s.
// We collect internal links from each seed page, then visit each one and assert
// an OK status and that no not-found state rendered.

const SEEDS = ["/", "/assets", "/validators", "/disputes", "/activity", "/portfolio"];
const MAX_VISITS = 90;

test("no internal link 404s from any top-level page", async ({ page }) => {
  test.setTimeout(180_000);

  const toVisit = new Set<string>(SEEDS);

  for (const seed of SEEDS) {
    const resp = await page.goto(seed);
    expect(resp?.status(), `seed ${seed} status`).toBeLessThan(400);
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") || ""));
    for (const h of hrefs) {
      if (!h || h.startsWith("//")) continue; // skip protocol-relative / external
      const path = h.split("#")[0];
      if (path) toVisit.add(path);
    }
  }

  const broken: { url: string; reason: string }[] = [];
  let visited = 0;

  for (const url of toVisit) {
    if (visited >= MAX_VISITS) break;
    visited++;
    const resp = await page.goto(url);
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      broken.push({ url, reason: `HTTP ${status}` });
      continue;
    }
    // Next's default not-found page (truly unmatched route)
    if ((await page.getByText(/This page could not be found/i).count()) > 0) {
      broken.push({ url, reason: "not-found page" });
    }
  }

  expect(broken, `broken internal links:\n${JSON.stringify(broken, null, 2)}`).toEqual([]);
  // sanity: we actually crawled beyond just the seeds
  expect(visited).toBeGreaterThan(SEEDS.length);
});
