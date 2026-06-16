import { test, expect } from "@playwright/test";
import { firstHref, idFromHref, endsWithPath, openPalette } from "./utils";

// FE-M2: universal resolution (`/objects/:id`), the clickable id graph, the
// `/tx/:digest` page, and the global ⌘K command palette.

test.describe("/objects/:id universal resolver (FE-M2)", () => {
  test("redirects an asset, validator, tx and address id to its typed page", async ({ page }) => {
    // asset id → /assets/:id
    await page.goto("/assets");
    const assetHref = await firstHref(page, "/assets/");
    await page.goto(`/objects/${idFromHref(assetHref)}`);
    await expect(page).toHaveURL(endsWithPath(assetHref));

    // validator pool id → /validators/:id
    await page.goto("/validators");
    const valHref = await firstHref(page, "/validators/");
    await page.goto(`/objects/${idFromHref(valHref)}`);
    await expect(page).toHaveURL(endsWithPath(valHref));

    // tx digest → /tx/:digest
    await page.goto("/activity");
    const txHref = await firstHref(page, "/tx/");
    await page.goto(`/objects/${idFromHref(txHref)}`);
    await expect(page).toHaveURL(endsWithPath(txHref));

    // 0x address → /address/:addr (sourced from a page that renders an address link;
    // the topbar wallet chip is now an account menu, not a bare link — FE-M7.2)
    await page.goto("/portfolio");
    const addrHref = await firstHref(page, "/address/");
    await page.goto(`/objects/${idFromHref(addrHref)}`);
    await expect(page).toHaveURL(endsWithPath(addrHref));
  });

  test("an unknown id shows the designed not-found state (no crash)", async ({ page }) => {
    await page.goto("/objects/this-is-not-a-real-object");
    await expect(page).toHaveURL(/\/objects\/this-is-not-a-real-object$/);
    await expect(page.getByText(/Object not indexed/i)).toBeVisible();
  });
});

test.describe("/tx/:digest (FE-M2)", () => {
  test("lists the events grouped under that digest", async ({ page }) => {
    await page.goto("/activity");
    const txHref = await firstHref(page, "/tx/");
    await page.goto(txHref);
    await expect(page.getByText("Events in this transaction")).toBeVisible();
    // the digest is shown, and at least one event row is rendered
    await expect(page.locator("ul.divide-y li").first()).toBeVisible();
    expect(await page.locator("ul.divide-y li").count()).toBeGreaterThan(0);
  });
});

test.describe("clickable id graph (FE-M2)", () => {
  test("clicking an IdLink chip navigates to its resolved page", async ({ page }) => {
    // the portfolio header renders the demo wallet as a linkable IdLink
    await page.goto("/portfolio");
    const chip = page.locator('a[href^="/address/"]').first();
    await expect(chip).toBeVisible();
    const href = await chip.getAttribute("href");
    await chip.click();
    await expect(page).toHaveURL(endsWithPath(href!));
    await expect(page.getByRole("button", { name: "Search the protocol" })).toBeVisible();
  });
});

test.describe("global ⌘K command palette (FE-M2)", () => {
  test("opens on the keyboard shortcut and closes on Escape", async ({ page }) => {
    await page.goto("/");
    const input = await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("searches and navigates to an asset, a validator and an address", async ({ page }) => {
    // gather one id of each kind from the live link graph
    await page.goto("/assets");
    const assetHref = await firstHref(page, "/assets/");
    await page.goto("/validators");
    const valHref = await firstHref(page, "/validators/");
    await page.goto("/portfolio");
    const addrHref = await firstHref(page, "/address/");

    const cases = [
      { query: idFromHref(assetHref), expected: assetHref },
      { query: idFromHref(valHref), expected: valHref },
      { query: idFromHref(addrHref), expected: addrHref },
    ];

    for (const c of cases) {
      await page.goto("/");
      const input = await openPalette(page);
      await input.fill(c.query);
      // a result is shown; Enter activates the top (highest-ranked) match
      await expect(page.getByRole("dialog")).toBeVisible();
      await input.press("Enter");
      await expect(page).toHaveURL(endsWithPath(c.expected));
    }
  });
});
