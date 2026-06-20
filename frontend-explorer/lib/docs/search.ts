// Pure docs search ranking — no import of the (heavy) generated page HTML, so a
// client component can import this and rank a search index passed as a prop
// without pulling every page's HTML into the browser bundle.

import type { DocSearchRecord } from "./generated";
export type { DocSearchRecord } from "./generated";

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function scoreTerm(term: string, r: DocSearchRecord): number {
  const heading = r.heading.toLowerCase();
  const title = r.pageTitle.toLowerCase();
  const text = r.text.toLowerCase();
  const kw = r.keywords.join(" ").toLowerCase();
  let s = 0;
  if (heading === term) s += 12;
  else if (heading.startsWith(term)) s += 9;
  else if (heading.includes(term)) s += 6;
  if (kw.includes(term)) s += 7;
  if (title.includes(term)) s += 4;
  if (text.includes(term)) s += 2;
  // typo tolerance: subsequence match on heading/keywords for longer terms
  if (s === 0 && term.length >= 4 && (isSubsequence(term, heading) || isSubsequence(term, kw))) s += 1;
  return s;
}

/**
 * Rank docs search records for a query. AND-ish across terms (every term must
 * contribute), title/heading/keyword hits outrank body text, with a subsequence
 * fallback for typos. Pure + deterministic.
 */
export function rankDocs(records: DocSearchRecord[], query: string, limit = 24): DocSearchRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: { r: DocSearchRecord; s: number }[] = [];
  for (const r of records) {
    let total = 0;
    let everyTermHits = true;
    for (const t of terms) {
      const ts = scoreTerm(t, r);
      if (ts === 0) {
        everyTermHits = false;
        break;
      }
      total += ts;
    }
    if (!everyTermHits) continue;
    if (r.anchor) total += 1; // a section hit beats the page-level stub
    scored.push({ r, s: total });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.r);
}
