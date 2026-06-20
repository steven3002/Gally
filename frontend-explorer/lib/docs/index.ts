// Public surface over the build-time-generated docs content. The markdown is the
// source of truth (repo-root `docs/*.md`); `generated.ts` is produced from it by
// `scripts/docs/gen.mjs`. Nothing here reads the filesystem — it's pure data, so
// it works in every render mode and the offline build.

import { DOCS_PAGES, DOCS_PARTS, DOCS_SEARCH, type DocPage } from "./generated";
import { rankDocs } from "./search";

export { DOCS_PAGES, DOCS_PARTS, DOCS_SEARCH };
export type { DocPage, DocSearchRecord, DocHeading } from "./generated";

export interface DocPartGroup {
  part: string;
  pages: DocPage[];
}

/** A lightweight nav link (no page HTML) — safe to pass into client components. */
export interface DocNavLink {
  title: string;
  route: string;
}
export interface DocNavGroup {
  part: string;
  pages: DocNavLink[];
}

const ordered = (): DocPage[] => [...DOCS_PAGES].sort((a, b) => a.order - b.order);

/** The four-part sidebar tree, parts in canonical order, pages by `order`. */
export function docNav(): DocPartGroup[] {
  return DOCS_PARTS.map((part) => ({
    part,
    pages: ordered().filter((p) => p.part === part),
  })).filter((g) => g.pages.length > 0);
}

/** Slim nav (title + route only) for client components — no page HTML shipped. */
export function docNavLinks(): DocNavGroup[] {
  return docNav().map((g) => ({
    part: g.part,
    pages: g.pages.map((p) => ({ title: p.title, route: p.route })),
  }));
}

export function pageByRoute(route: string): DocPage | undefined {
  return DOCS_PAGES.find((p) => p.route === route);
}

/** Resolve a catch-all `[...slug]` param (e.g. ["guides","investor"]) to a page. */
export function pageBySlug(slugParts: string[] | undefined): DocPage | undefined {
  const slug = (slugParts ?? []).join("/");
  return pageByRoute(slug ? `/docs/${slug}` : "/docs");
}

export function prevNext(page: DocPage): { prev?: DocPage; next?: DocPage } {
  const all = ordered();
  const i = all.findIndex((p) => p.route === page.route);
  return {
    prev: i > 0 ? all[i - 1] : undefined,
    next: i >= 0 && i < all.length - 1 ? all[i + 1] : undefined,
  };
}

// === Smart, offline search ===

/** Rank the full docs index for a query (server/test entry; client uses rankDocs). */
export function searchDocs(query: string, limit = 24) {
  return rankDocs(DOCS_SEARCH, query, limit);
}
