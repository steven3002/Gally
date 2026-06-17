import { test, expect } from "@playwright/test";
import { firstHref } from "./utils";

// FE-M7.2: permissionless cranks (spec §2.2 verb #9). Eligibility is derived from
// live fixture state and mirrors the Move preconditions, so the UI runs a crank
// only when the contract would accept it — and otherwise shows why / when.

test.describe("permissionless cranks (FE-M7.2)", () => {
  test("/cranks lists runnable and pending keeper operations", async ({ page }) => {
    await page.goto("/cranks");
    await expect(page.getByRole("heading", { level: 1, name: "Maintenance" })).toBeVisible();

    // at least one runnable crank (sweep) and a time-gated pending one with a reason
    const main = page.getByRole("main");
    await expect(main.getByText("Runnable now", { exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Sweep rollover", exact: true }).first()).toBeVisible();
    await expect(main.getByText("Pending", { exact: true })).toBeVisible();
    await expect(main.getByText(/— available in/i).first()).toBeVisible();
  });

  test("a runnable sweep crank runs through the execution seam and reconciles", async ({ page }) => {
    await page.goto("/cranks");
    await page.getByRole("button", { name: "Sweep rollover", exact: true }).first().click();

    const dialog = page.getByRole("dialog", { name: "Sweep rollover" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/permissionless/i).first()).toBeVisible();
    await dialog.getByRole("button", { name: /Confirm sweep rollover/i }).click();
    await expect(dialog.getByText("Sweep rollover confirmed")).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Close" }).click();

    // optimistic reconciliation: the run crank collapses to an applied chip
    await expect(page.getByText("Sweep rollover submitted").first()).toBeVisible();
  });

  test("an asset page surfaces its applicable crank (rollover reserve funded)", async ({ page }) => {
    await page.goto("/assets/asset02"); // OPERATIONAL with a funded rollover reserve
    await expect(page.getByRole("main").getByText("Maintenance")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sweep rollover", exact: true })).toBeVisible();
  });

  test("a defaulted asset can sweep compensation once the grace window has elapsed", async ({ page }) => {
    await page.goto("/assets/asset12"); // DEFAULTED, grace elapsed
    await expect(page.getByRole("button", { name: "Sweep compensation", exact: true })).toBeVisible();
  });

  test("the dispute page gates resolve_dispute until the voting window closes", async ({ page }) => {
    await page.goto("/assets/asset08"); // has the open dispute
    await page.getByRole("button", { name: /Disputes/ }).click();
    const dispHref = await firstHref(page, "/disputes/");
    await page.goto(dispHref);
    await expect(page.getByText(/Resolve dispute — available/i)).toBeVisible();
  });
});
