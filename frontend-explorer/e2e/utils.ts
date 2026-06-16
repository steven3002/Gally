import { type Page, expect } from "@playwright/test";

/** First internal href on the page starting with `prefix` (hash stripped). */
export async function firstHref(page: Page, prefix: string): Promise<string> {
  const loc = page.locator(`a[href^="${prefix}"]`).first();
  await expect(loc, `expected a link starting with ${prefix}`).toBeAttached();
  const href = await loc.getAttribute("href");
  if (!href) throw new Error(`no href for prefix ${prefix}`);
  return href.split("#")[0];
}

/** The trailing id segment of a route href, decoded. */
export function idFromHref(href: string): string {
  return decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "");
}

/** A RegExp matching a URL whose path ends with `path` (optional query allowed). */
export function endsWithPath(path: string): RegExp {
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(esc + "(\\?.*)?$");
}

/**
 * Open the global ⌘K palette and return its search input. The keyboard
 * shortcut is a client listener, so a single keypress fired before React
 * hydrates is silently dropped; re-press until the palette actually opens.
 */
export async function openPalette(page: Page) {
  const input = page.getByPlaceholder(/Search assets/i);
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return input;
}
