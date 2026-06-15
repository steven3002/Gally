import { test, expect } from "@playwright/test";

// FE-M5: asset health, default-risk & holder-protection.
//   - the §13 unwrap-before-deadline alert on the portfolio (demo holds wrapped
//     tokens in a COMPENSATING asset)
//   - the compensation grace countdown on the asset page
//   - the forward-looking default-risk clock on an EXECUTING asset
//   - the solvency/health badge on an OPERATIONAL asset
//
// asset08 (COMPENSATING, wrapping-frozen) and asset03 (EXECUTING) are guaranteed
// fixtures (every AssetState has ≥1 asset — see invariants.test.ts).

test.describe("health, risk & holder-protection (FE-M5)", () => {
  test("portfolio shows the unwrap-before-deadline holder-protection alert", async ({ page }) => {
    await page.goto("/portfolio");
    // the §13 obligation: an unmissable unwrap alert WITH a deadline
    await expect(page.getByText(/unwrap to keep your compensation/i)).toBeVisible();
    const cta = page.getByText(/Unwrap before/i).first();
    await expect(cta).toBeVisible();
    // the alert links to the at-risk (compensating) asset
    await expect(page.locator('a[href="/assets/asset08"]').first()).toBeVisible();
  });

  test("a COMPENSATING asset shows the compensation grace countdown + stack", async ({ page }) => {
    await page.goto("/assets/asset08");
    await expect(page.getByText(/This asset is in compensation/i)).toBeVisible();
    await expect(page.getByText(/grace window/i).first()).toBeVisible();
    // three-layer restitution stack
    await expect(page.getByText("Compensation stack")).toBeVisible();
    await expect(page.getByText("Undeployed escrow")).toBeVisible();
  });

  test("an EXECUTING asset shows the next-tranche default-risk countdown", async ({ page }) => {
    await page.goto("/assets/asset03");
    await expect(page.getByText(/Milestone \d+ (due|overdue)/i)).toBeVisible();
  });

  test("an OPERATIONAL asset shows a solvency/health indicator from ledger data", async ({ page }) => {
    await page.goto("/assets/asset01");
    await expect(page.getByText("Reward-pool solvency")).toBeVisible();
    await expect(page.getByText("Healthy").first()).toBeVisible();
  });
});
