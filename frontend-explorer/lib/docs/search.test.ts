import { describe, it, expect } from "vitest";
import {
  DOCS_PAGES,
  DOCS_PARTS,
  docNav,
  pageBySlug,
  pageByRoute,
  prevNext,
  searchDocs,
} from "./index";

describe("docs content set", () => {
  it("has all 18 pages with unique orders 1..18", () => {
    expect(DOCS_PAGES.length).toBe(18);
    const orders = DOCS_PAGES.map((p) => p.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("every page has the required fields and renders HTML", () => {
    for (const p of DOCS_PAGES) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(DOCS_PARTS).toContain(p.part);
      expect(p.route.startsWith("/docs")).toBe(true);
      expect(p.html.length).toBeGreaterThan(40);
      expect(p.keywords.length).toBeGreaterThan(0);
    }
  });

  it("groups into the four parts covering every page", () => {
    const groups = docNav();
    expect(groups.map((g) => g.part)).toEqual([...DOCS_PARTS]);
    expect(groups.reduce((n, g) => n + g.pages.length, 0)).toBe(18);
  });

  it("resolves routes and catch-all slugs", () => {
    expect(pageByRoute("/docs")?.order).toBe(1);
    expect(pageBySlug(["guides", "investor"])?.route).toBe("/docs/guides/investor");
    expect(pageBySlug(["wrapping"])?.title).toMatch(/Wrapping/);
    expect(pageBySlug(["does-not-exist"])).toBeUndefined();
  });

  it("links prev/next in order", () => {
    const first = pageByRoute("/docs")!;
    expect(prevNext(first).prev).toBeUndefined();
    expect(prevNext(first).next?.route).toBe("/docs/concepts");
  });

  it("renders math (MathML) and a diagram in the generated HTML", () => {
    expect(pageByRoute("/docs/economics")!.html).toContain("<math");
    expect(pageByRoute("/docs/economics")!.html).toContain("<mfrac>");
    expect(pageByRoute("/docs/lifecycle")!.html).toContain("doc-diagram");
    expect(pageByRoute("/docs/wrapping")!.html).toContain("<math");
  });
});

describe("smart docs search", () => {
  it("returns nothing for an empty query", () => {
    expect(searchDocs("")).toEqual([]);
    expect(searchDocs("   ")).toEqual([]);
  });

  it("finds the wrapping page for collateral/DeFi queries", () => {
    const routes = searchDocs("wrap collateral").map((r) => r.route);
    expect(routes).toContain("/docs/wrapping");
  });

  it("finds refund guidance", () => {
    const routes = searchDocs("refund").map((r) => r.route);
    expect(routes.some((r) => r === "/docs/guides/investor" || r === "/docs/faq")).toBe(true);
  });

  it("answers a safety question", () => {
    const routes = searchDocs("is my money safe").map((r) => r.route);
    expect(routes.some((r) => r === "/docs/security" || r === "/docs/faq")).toBe(true);
  });

  it("returns section-level anchors, not just pages", () => {
    const hits = searchDocs("diamond hand");
    expect(hits.some((h) => h.anchor.length > 0)).toBe(true);
  });

  it("tolerates a small typo via subsequence fallback", () => {
    // "validatr" (missing o) should still surface validator content
    const routes = searchDocs("validatr").map((r) => r.route);
    expect(routes.length).toBeGreaterThan(0);
  });
});
