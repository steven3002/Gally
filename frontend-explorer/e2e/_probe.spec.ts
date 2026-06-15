import { test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 800 } });

test("probe overflow", async ({ page }) => {
  const paths = ["/", "/assets", "/assets/asset01", "/portfolio", "/governance", "/validators"];
  for (const p of paths) {
    await page.goto(p);
    const info = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const winW = window.innerWidth;
      const offenders: string[] = [];
      if (docW > winW + 1) {
        document.querySelectorAll<HTMLElement>("*").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > winW + 1 && r.width > 0) {
            offenders.push(
              `${el.tagName}.${(el.className || "").toString().slice(0, 60)} right=${Math.round(r.right)} w=${Math.round(r.width)}`,
            );
          }
        });
      }
      return { docW, winW, offenders: offenders.slice(0, 6) };
    });
    console.log(`[${p}] doc=${info.docW} win=${info.winW}`, info.offenders);
  }
});
