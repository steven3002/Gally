// Per-asset holder ledgers (FE-M1). The data substrate for holders pages and
// address pages: who holds each asset, deeds vs wrapped, and the cross-asset
// holdings of any address. Generated deterministically and EXACTLY so the mock
// invariants hold (explorer_spec.md §5.4):
//   MI-1  Σ(shareCount + wrapped) == total_minted_shares == funding_goal
//   MI-2  Σ wrapped == accumulator.total_wrapped_shares
//
// The connected DEMO_WALLET's positions are seeded from `portfolio` so the
// ledger and the portfolio page never disagree about the demo's deeds/wrapped.

import type { Asset, HolderEntry, Holding } from "../types";
import { assets, assetById, portfolio, DEMO_WALLET } from "./data";
import { INVESTOR_PERSONAS } from "./accounts";
import { seeded } from "./series";
import { NOW } from "../format";

/** States in which GallyShare holders exist (post-finalize). */
const FUNDED_STATES = new Set([
  "FUNDED",
  "EXECUTING",
  "OPERATIONAL",
  "DEFAULTED",
  "COMPENSATING",
  "CLOSED",
]);

/** Integer largest-remainder split of `amount` over `weights` (each bucket ≥ minEach). */
function splitExact(amount: number, weights: number[], minEach = 0): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const base = minEach * n;
  const rest = amount - base; // distribute this by weight
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (rest * w) / total);
  const out = raw.map((r) => Math.floor(r));
  let left = rest - out.reduce((a, b) => a + b, 0);
  // hand out the leftover units to the largest fractional remainders
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  // any residual (left>order.length, only if amount<base) dumped on bucket 0
  if (left > 0) out[0] += left;
  return out.map((v) => v + minEach);
}

/** Deterministic 64-hex address for an anonymous holder of `assetId`. */
function anonAddr(rnd: () => number): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 64; i++) s += hex[Math.floor(rnd() * 16)];
  return s;
}

function buildLedger(a: Asset): HolderEntry[] {
  if (!FUNDED_STATES.has(a.state) || a.holders <= 0) return [];

  const minted = a.accumulator?.totalMintedShares ?? a.fundingGoal;
  const wrappedTotal = a.accumulator?.totalWrappedShares ?? 0;
  const cumIndex = a.accumulator?.cumulativeIndex ?? 0;
  const rnd = seeded(a.id.length * 7919 + minted);

  // 1) Fixed holders — the demo wallet, seeded from its portfolio position.
  const fixed: { address: string; total: number; wrapped: number }[] = [];
  const demoPos = portfolio.find((p) => p.assetId === a.id);
  if (demoPos) fixed.push({ address: DEMO_WALLET, total: demoPos.deeds + demoPos.wrapped, wrapped: demoPos.wrapped });

  // 2) Free holder addresses: named personas first (so their address pages are
  //    rich across assets), then anonymous to reach the holder count.
  const named = INVESTOR_PERSONAS.filter((p) => p.address !== DEMO_WALLET).map((p) => p.address);
  const freeCount = Math.max(0, a.holders - fixed.length);
  const freeAddrs: string[] = [];
  for (let i = 0; i < freeCount; i++) {
    freeAddrs.push(i < named.length ? named[i] : anonAddr(rnd));
  }

  // 3) Split the remaining supply (after fixed) across the free holders.
  const fixedTotal = fixed.reduce((s, f) => s + f.total, 0);
  const fixedWrapped = fixed.reduce((s, f) => s + f.wrapped, 0);
  const freeSupply = minted - fixedTotal;
  const weights = freeAddrs.map(() => 0.2 + rnd() * rnd()); // skewed: a few whales, a long tail
  const totals = freeAddrs.length ? splitExact(freeSupply, weights, 1) : [];

  // 4) Distribute the remaining wrapped supply across free holders, capped by each total.
  const wrap = new Array(freeAddrs.length).fill(0);
  const remW = wrappedTotal - fixedWrapped;
  if (remW > 0 && freeAddrs.length) {
    const wWeights = totals.map((t) => t * (0.3 + rnd())); // wrap propensity varies
    const wRaw = splitExact(remW, wWeights, 0).map((v, i) => Math.min(v, totals[i]));
    for (let i = 0; i < wrap.length; i++) wrap[i] = wRaw[i];
    let placed = wrap.reduce((a, b) => a + b, 0);
    // place any shortfall (from capping) onto holders with spare capacity
    let i = 0;
    let guard = 0;
    while (placed < remW && guard < freeAddrs.length * 4) {
      const idx = i % freeAddrs.length;
      if (wrap[idx] < totals[idx]) {
        wrap[idx]++;
        placed++;
      }
      i++;
      guard++;
    }
  }

  const entries: HolderEntry[] = [];
  for (const f of fixed) {
    entries.push({
      address: f.address,
      shareCount: f.total - f.wrapped,
      wrapped: f.wrapped,
      acquiredAtMs: a.createdAtMs + Math.round((NOW - a.createdAtMs) * 0.2),
      yieldClaimedIndex: Math.round(cumIndex * 0.85 * 1e6) / 1e6,
    });
  }
  for (let i = 0; i < freeAddrs.length; i++) {
    const total = totals[i];
    const w = wrap[i];
    entries.push({
      address: freeAddrs[i],
      shareCount: total - w,
      wrapped: w,
      acquiredAtMs: a.createdAtMs + Math.round((NOW - a.createdAtMs) * (0.05 + rnd() * 0.8)),
      yieldClaimedIndex: Math.round(cumIndex * rnd() * 1e6) / 1e6,
    });
  }
  // ranked by total holding, desc
  entries.sort((x, y) => y.shareCount + y.wrapped - (x.shareCount + x.wrapped));
  return entries;
}

/** assetId → holder ledger (ranked). */
export const holderLedger: Record<string, HolderEntry[]> = Object.fromEntries(
  assets.map((a) => [a.id, buildLedger(a)]),
);

/** Ranked holders of one asset. */
export const holdersOf = (assetId: string): HolderEntry[] => holderLedger[assetId] ?? [];

/** Supply summary for an asset (minted / wrapped / unwrapped). */
export function supplyOf(assetId: string): { minted: number; wrapped: number; unwrapped: number } {
  const a = assetById[assetId];
  const minted = a?.accumulator?.totalMintedShares ?? a?.fundingGoal ?? 0;
  const wrapped = a?.accumulator?.totalWrappedShares ?? 0;
  return { minted, wrapped, unwrapped: minted - wrapped };
}

/** All holdings of one address, across every asset, joined to asset context. */
export function holdingsOf(address: string): Holding[] {
  const out: Holding[] = [];
  for (const a of assets) {
    const entry = (holderLedger[a.id] ?? []).find((h) => h.address === address);
    if (!entry) continue;
    const cumIndex = a.accumulator?.cumulativeIndex ?? 0;
    const pendingYield = Math.max(0, Math.round((cumIndex - entry.yieldClaimedIndex) * entry.shareCount));
    out.push({
      ...entry,
      assetId: a.id,
      assetName: a.name,
      ticker: a.ticker,
      tokenSymbol: a.accumulator?.tokenSymbol,
      category: a.category,
      state: a.state,
      apy: a.accumulator?.apy ?? 0,
      pendingYield,
    });
  }
  return out.sort((x, y) => y.shareCount + y.wrapped - (x.shareCount + x.wrapped));
}

/** Count of distinct holders of an asset (== ledger length). */
export const holderCount = (assetId: string): number => (holderLedger[assetId] ?? []).length;

/** A holder joined with its total holding and share of total minted supply. */
export interface RankedHolder extends HolderEntry {
  total: number; // deeds + wrapped
  pctOfSupply: number; // total / total_minted_shares * 100
}

/**
 * Ranked holder distribution of an asset: each holder's total and % of supply.
 * Because Σ total == total_minted_shares (MI-1), Σ pctOfSupply == 100 (±float dust).
 * Powers the holders ledger + distribution visuals (FE-M3).
 */
export function holderDistribution(assetId: string): RankedHolder[] {
  const minted = supplyOf(assetId).minted || 1;
  return holdersOf(assetId).map((h) => {
    const total = h.shareCount + h.wrapped;
    return { ...h, total, pctOfSupply: (total / minted) * 100 };
  });
}
