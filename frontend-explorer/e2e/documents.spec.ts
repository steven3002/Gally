import { test, expect } from "@playwright/test";
import { firstHref } from "./utils";

// FE-M4: documents are retrievable + verifiable — legal docs, tranche proofs and
// dispute evidence, each rendered with an open link + on-chain sha256 + attestor.

test.describe("documents & on-chain verification (FE-M4)", () => {
  test("asset legal documents show an open link, sha256 and a linked attestor", async ({ page }) => {
    // an operational (therefore vouched) asset is guaranteed via the demo holdings
    await page.goto("/portfolio");
    const assetHref = await firstHref(page, "/assets/");
    await page.goto(assetHref);

    await expect(page.getByText("Legal documents")).toBeVisible();
    await expect(page.getByText(/sha256-pinned/i).first()).toBeVisible();
    await expect(page.locator('a[href*="walrus"]').first()).toBeVisible();
    await expect(page.getByText(/Attested by/i).first()).toBeVisible();
  });

  test("a released tranche shows its milestone proof document", async ({ page }) => {
    await page.goto("/portfolio");
    const assetHref = await firstHref(page, "/assets/");
    await page.goto(assetHref);

    await page.getByRole("button", { name: /Tranches/ }).click();
    await expect(page.getByText("Milestone proof").first()).toBeVisible();
    await expect(page.locator('a[href*="walrus"]').first()).toBeVisible();
  });

  test("a dispute detail page surfaces its on-chain evidence", async ({ page }) => {
    await page.goto("/disputes");
    const dispHref = await firstHref(page, "/disputes/");
    await page.goto(dispHref);

    await expect(page.getByText("On-chain evidence")).toBeVisible();
    await expect(page.getByText(/sha256-pinned/i).first()).toBeVisible();
    await expect(page.locator('a[href*="walrus"]').first()).toBeVisible();
  });
});
