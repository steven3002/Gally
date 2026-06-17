import { test, expect, type Page } from "@playwright/test";
import { firstHref } from "./utils";

// FE-M7.2: the full user-verb matrix. Every investor/holder/challenger verb in
// spec §2.2 runs end-to-end through the one mock execution seam (build → sign →
// pending → success), plus optimistic cross-page reconciliation. Cranks (verb #9)
// have their own spec (cranks.spec.ts).

/** Drive an action trigger through its modal to a confirmed outcome. */
async function runAction(
  page: Page,
  trigger: string,
  opts: { success?: string } = {},
) {
  await page.getByRole("button", { name: trigger, exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: trigger });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(`Confirm ${trigger}`, "i") }).click();
  await expect(dialog.getByText(opts.success ?? `${trigger} confirmed`)).toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe("user-verb matrix (FE-M7.2)", () => {
  test("contribute — invest in a FUNDING asset", async ({ page }) => {
    await page.goto("/assets/asset04");
    await runAction(page, "Buy Shares");
  });

  test("claim_shares — convert a finalized receipt to deeds", async ({ page }) => {
    await page.goto("/portfolio");
    await runAction(page, "Claim deeds");
  });

  test("refund — liquidate a failed-raise receipt (exit, no pause gate)", async ({ page }) => {
    await page.goto("/portfolio");
    await runAction(page, "Sell Shares");
  });

  test("claim_rewards — claim yield on a holding", async ({ page }) => {
    await page.goto("/portfolio");
    await runAction(page, "Claim yield");
  });

  test("wrap — wrap deeds into Coin<T>", async ({ page }) => {
    await page.goto("/portfolio");
    await runAction(page, "Wrap");
  });

  test("unwrap — unwrap Coin<T> back to deeds (the compensation escape hatch)", async ({ page }) => {
    await page.goto("/portfolio");
    await runAction(page, "Unwrap");
  });

  test("split — split a GallyShare deed object", async ({ page }) => {
    await page.goto("/portfolio");
    await runAction(page, "Split");
  });

  test("raise_dispute — challenge a validator's attestation", async ({ page }) => {
    // reach a validator that has vouched assets (so the challenge action is offered)
    await page.goto("/assets/asset01");
    const validatorHref = await firstHref(page, "/validators/");
    await page.goto(validatorHref);
    await runAction(page, "Raise dispute");
  });

  test("optimistic reconciliation: claim-all clears the per-holding claims and the bell alert (cross-page)", async ({ page }) => {
    await page.goto("/portfolio");

    // before: there are claimable holdings and a "yield ready" alert in the bell
    expect(await page.getByRole("button", { name: "Claim yield", exact: true }).count()).toBeGreaterThan(0);

    // claim everything
    await page.getByRole("button", { name: "Claim all", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Claim all" });
    await dialog.getByRole("button", { name: /Confirm claim all/i }).click();
    await expect(dialog.getByText("Claim all confirmed")).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Close" }).click();

    // after: the per-holding Claim buttons have reconciled to applied chips
    await expect(page.getByRole("button", { name: "Claim yield", exact: true })).toHaveCount(0);
    await expect(page.getByText("Yield claimed").first()).toBeVisible();

    // persists across navigation, and the GLOBAL bell alert has cleared (cross-page)
    await page.goto("/");
    await page.getByRole("button", { name: /Notifications/ }).click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/ready to claim/i)).toHaveCount(0);
  });
});
