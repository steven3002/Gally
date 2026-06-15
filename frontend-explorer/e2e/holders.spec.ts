import { test, expect } from "@playwright/test";
import { firstHref, idFromHref, endsWithPath } from "./utils";

// FE-M3: address pages for any account, per-asset holder ledgers, and the
// "who holds a thing → click a holder → see what *they* hold" traversal.

test.describe("holder ledger + address pages (FE-M3)", () => {
  test("asset holders → click a holder → their address page shows holdings", async ({ page }) => {
    // the demo portfolio only holds finalized assets, so this is a real ledger
    await page.goto("/portfolio");
    const assetHref = await firstHref(page, "/assets/");
    const assetId = idFromHref(assetHref);

    await page.goto(`/assets/${assetId}/holders`);
    await expect(page.getByText("Holder ledger")).toBeVisible();

    // top holder row links to its /address page
    const holderHref = await firstHref(page, "/address/");
    await page.goto(holderHref);
    await expect(page).toHaveURL(endsWithPath(holderHref));
    await expect(page.getByText("Holdings", { exact: true })).toBeVisible();
    await expect(page.getByText(/deeds/i).first()).toBeVisible();
  });

  test("an asset's Holders tab links to the full ledger + distribution", async ({ page }) => {
    await page.goto("/portfolio");
    const assetHref = await firstHref(page, "/assets/");
    await page.goto(assetHref);

    await page.getByRole("button", { name: /Holders/ }).click();
    const viewAll = page.getByRole("link", { name: /View all/ });
    await expect(viewAll).toBeVisible();
    await viewAll.click();
    await expect(page).toHaveURL(/\/assets\/[^/]+\/holders$/);
    await expect(page.getByText("Distribution")).toBeVisible();
  });

  test("an entity address surfaces the ENTITY role", async ({ page }) => {
    await page.goto("/assets");
    const assetHref = await firstHref(page, "/assets/");
    await page.goto(assetHref);
    // the entity name in the asset header links to its address page (the header
    // <p> uniquely holds the entity link; other /address links are event actors)
    const entityHref = await page.locator('p a[href^="/address/"]').first().getAttribute("href");
    await page.goto(entityHref!);
    await expect(page.getByText("Entity", { exact: true }).first()).toBeVisible();
  });

  test("/portfolio renders via the shared address surface", async ({ page }) => {
    await page.goto("/portfolio");
    await expect(page.getByText("Demo wallet")).toBeVisible();
    await expect(page.getByText("Allocation", { exact: true })).toBeVisible();
    await expect(page.getByText("Holdings", { exact: true })).toBeVisible();
  });

  test("an address with no holdings shows the designed empty state", async ({ page }) => {
    await page.goto("/address/0x" + "0".repeat(64));
    await expect(page.getByText(/No share holdings/i)).toBeVisible();
  });
});
