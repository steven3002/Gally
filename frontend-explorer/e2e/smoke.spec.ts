import { test, expect } from "@playwright/test";
import { firstHref } from "./utils";

// FE-M1 page-smoke harness: every top-level page (and one detail page of each
// kind, reached by following the real link graph) renders the app shell and
// returns an OK status. Pure mock data — no live I/O.

const STATIC_ROUTES = ["/", "/assets", "/validators", "/disputes", "/activity", "/portfolio"];

test.describe("page smoke (FE-M1)", () => {
  for (const route of STATIC_ROUTES) {
    test(`loads ${route}`, async ({ page }) => {
      const resp = await page.goto(route);
      expect(resp?.ok(), `HTTP ok for ${route}`).toBeTruthy();
      // app shell rendered (topbar search button is in the layout on every page)
      await expect(page.getByRole("button", { name: "Search the protocol" })).toBeVisible();
      await expect(page.locator("main")).not.toBeEmpty();
    });
  }

  test("loads a detail page for each kind via the link graph", async ({ page }) => {
    // asset detail
    await page.goto("/assets");
    let resp = await page.goto(await firstHref(page, "/assets/"));
    expect(resp?.ok(), "asset detail").toBeTruthy();

    // validator detail
    await page.goto("/validators");
    resp = await page.goto(await firstHref(page, "/validators/"));
    expect(resp?.ok(), "validator detail").toBeTruthy();

    // transaction page (event rows link to /tx/:digest)
    await page.goto("/activity");
    resp = await page.goto(await firstHref(page, "/tx/"));
    expect(resp?.ok(), "tx page").toBeTruthy();

    // address page (the demo-wallet chip in the topbar links to /address/:addr)
    resp = await page.goto(await firstHref(page, "/address/"));
    expect(resp?.ok(), "address page").toBeTruthy();
  });
});
