import { test, expect } from "@playwright/test";

// DOC-M4 — the in-app /docs site: route rendering, math + diagrams, sidebar
// navigation, and the offline smart search. Pure static content (no live I/O).

test.describe("docs site (DOC-M4)", () => {
  test("docs home renders with the four-part nav", async ({ page }) => {
    const resp = await page.goto("/docs");
    expect(resp?.ok(), "HTTP ok for /docs").toBeTruthy();
    await expect(page.locator("main")).not.toBeEmpty();
    // a page link from the sidebar (the visible, desktop copy)
    await expect(page.locator("a:visible", { hasText: "Core Concepts" }).first()).toBeVisible();
    await expect(page.locator("a:visible", { hasText: "The Economic Model" }).first()).toBeVisible();
  });

  test("renders MathML and a diagram from the markdown", async ({ page }) => {
    await page.goto("/docs/economics");
    await expect(page.locator(".doc-prose math").first()).toBeVisible();
    await page.goto("/docs/lifecycle");
    await expect(page.locator(".doc-diagram").first()).toBeVisible();
  });

  test("sidebar navigates to the wrapping page", async ({ page }) => {
    await page.goto("/docs");
    await page.locator("a:visible", { hasText: "Wrapping, Liquidity & Collateral" }).first().click();
    await expect(page).toHaveURL(/\/docs\/wrapping$/);
    await expect(page.getByRole("heading", { name: /Wrapping/ })).toBeVisible();
  });

  test("smart search finds a page and navigates to it", async ({ page }) => {
    await page.goto("/docs");
    const input = page.getByPlaceholder(/Search the docs/i);
    // The "/" shortcut is a client listener — retry until React has hydrated.
    await expect(async () => {
      await page.keyboard.press("/");
      await expect(input).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await input.fill("wrap collateral");
    await expect(page.getByRole("dialog", { name: /Search documentation/i }).getByRole("button").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/wrapping/);
  });
});
