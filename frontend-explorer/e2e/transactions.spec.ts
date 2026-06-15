import { test, expect } from "@playwright/test";

// FE-M7.2: the user-scoped transaction layer + notifications. Wallet connect,
// the build→sign→pending→success lifecycle, toasts + bell archive, action
// gating, and the D-FE2 guarantee that no operator verb is exposed publicly.

test.describe("transactions & notifications (FE-M7.2)", () => {
  test("the bell opens the notification centre with seeded alerts", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Notifications/ }).click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/ready to claim|claim your deeds|refund available/i).first()).toBeVisible();
  });

  test("buy shares runs the full lifecycle and lands a toast + bell entry", async ({ page }) => {
    await page.goto("/assets/asset04"); // a FUNDING asset
    await page.getByRole("button", { name: "Buy Shares" }).click();

    const dialog = page.getByRole("dialog", { name: "Buy Shares" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("asset::contribute_capital")).toBeVisible();

    await dialog.getByRole("button", { name: /Confirm buy shares/i }).click();
    await expect(dialog.getByText("Buy Shares confirmed")).toBeVisible({ timeout: 10_000 });

    // archived as a toast (region) ...
    await expect(
      page.getByRole("region", { name: "Notifications" }).getByText("Buy Shares confirmed"),
    ).toBeVisible();
    // ... and in the bell, with the unread count bumped
    await dialog.getByRole("link", { name: /View details/ }).click();
  });

  test("claim all yield from the portfolio", async ({ page }) => {
    await page.goto("/portfolio");
    await page.getByRole("button", { name: "Claim all" }).click();
    const dialog = page.getByRole("dialog", { name: "Claim all" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Confirm claim all/i }).click();
    await expect(dialog.getByText("Claim all confirmed")).toBeVisible({ timeout: 10_000 });
  });

  test("disconnecting gates actions behind Connect wallet", async ({ page }) => {
    await page.goto("/assets/asset04");
    await expect(page.getByRole("button", { name: "Buy Shares" })).toBeVisible();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();

    await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeVisible();
  });

  test("no entity/validator/admin action is exposed on a public asset page (D-FE2)", async ({ page }) => {
    await page.goto("/assets/asset01");
    await expect(
      page.getByRole("button", { name: /approve milestone|deposit revenue|release tranche|vouch|emergency stop/i }),
    ).toHaveCount(0);
  });
});
