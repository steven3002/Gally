import { test, expect } from "@playwright/test";
import { firstHref } from "./utils";

// FE-M6: token/accumulator pages + governance surface + global pause banner +
// the full three-way revenue split on the asset page.

test.describe("governance & protocol status (FE-M6)", () => {
  test("/governance lists every param and a param-change history entry", async ({ page }) => {
    await page.goto("/governance");
    await expect(page.getByRole("heading", { name: "Parameters" })).toBeVisible();
    await expect(page.getByText("Protocol fee").first()).toBeVisible();
    await expect(page.getByText("Compensation grace").first()).toBeVisible();
    // event-only param history
    await expect(page.getByRole("heading", { name: "Parameter-change history" })).toBeVisible();
    await expect(page.getByText(/Parameter changed —/).first()).toBeVisible();
  });

  test("toggling the paused fixture shows the global pause banner; default hides it", async ({ page }) => {
    await page.goto("/governance");
    // default fixture is not paused → no global banner
    await expect(page.getByText("Protocol operational")).toBeVisible();
    await expect(page.getByText(/Capital entry is halted/i)).toHaveCount(0);
    // flip the preview → the app-shell banner appears
    await page.getByRole("button", { name: /Preview pause banner/i }).click();
    await expect(page.getByText(/Capital entry is halted/i)).toBeVisible();
  });

  test("/tokens/:accId renders supply + a holders ledger, reachable from the asset", async ({ page }) => {
    await page.goto("/portfolio");
    const assetHref = await firstHref(page, "/assets/");
    await page.goto(assetHref);
    // the accumulator card links to the token page
    const tokenHref = await firstHref(page, "/tokens/");
    await page.goto(tokenHref);
    await expect(page.getByText("Total supply").first()).toBeVisible();
    await expect(page.getByText("Wrap ratio")).toBeVisible();
    await expect(page.getByText("Holder ledger")).toBeVisible();
  });

  test("the asset page shows the complete three-way revenue split", async ({ page }) => {
    await page.goto("/assets/asset01");
    await page.getByRole("button", { name: /Yield & revenue/ }).click();
    await expect(page.getByText("Revenue distribution")).toBeVisible();
    await expect(page.getByText("Protocol fee", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Investor split", { exact: true })).toBeVisible();
    await expect(page.getByText("Entity remainder", { exact: true })).toBeVisible();
  });
});
