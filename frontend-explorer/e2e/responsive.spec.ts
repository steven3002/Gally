import { test, expect } from "@playwright/test";

// FE-M7: responsive + a11y hardening. Verified at the mobile breakpoint (375px):
// no horizontal overflow on key pages, the mobile drawer navigates, and a
// transaction modal is usable. Keyboard operability of ⌘K is covered in
// resolution.spec.ts.

test.describe("responsive hardening @ 375px (FE-M7)", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  const noOverflow = (page: import("@playwright/test").Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  test("no horizontal overflow on key pages (light + dark)", async ({ page }) => {
    const paths = ["/", "/assets", "/assets/asset01", "/portfolio", "/governance", "/validators"];
    for (const p of paths) {
      await page.goto(p);
      expect(await noOverflow(page), `overflow at ${p}`).toBe(true);
    }
    // dark theme
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    for (const p of ["/", "/assets/asset01", "/portfolio"]) {
      await page.goto(p);
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      expect(await noOverflow(page), `dark overflow at ${p}`).toBe(true);
    }
  });

  test("the mobile drawer opens and navigates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Validators" }).click();
    await expect(page).toHaveURL(/\/validators$/);
  });

  test("an action modal is usable on mobile", async ({ page }) => {
    await page.goto("/assets/asset04");
    await page.getByRole("button", { name: "Contribute" }).click();
    const dialog = page.getByRole("dialog", { name: "Contribute" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Confirm contribute/i }).click();
    await expect(dialog.getByText("Contribute confirmed")).toBeVisible({ timeout: 10_000 });
  });
});
