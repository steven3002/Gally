// FE-M6 unit tests: the three-way revenue split (fee + investor + entity ==
// gross), governance param-history ordering, and the token-page supply identity
// (minted == wrapped + unwrapped, MI-1). Pairs with e2e/governance.spec.ts.

import { describe, it, expect } from "vitest";
import type { AssetState } from "../types";
import { assets, assetById, assetByAccId } from "./data";
import { revenueSplitOf } from "./activity";
import { supplyOf } from "./holders";
import { governanceHistory, protocolConfig } from "./governance";

const OPERATIONAL = assets.filter((a) => a.state === "OPERATIONAL" || a.state === "CLOSED");

describe("three-way revenue split (§10, D9)", () => {
  it("fee + investor + entity == gross for every revenue-bearing asset", () => {
    for (const a of OPERATIONAL) {
      const s = revenueSplitOf(a.id);
      expect(s.fee + s.investor + s.entity).toBe(s.gross);
    }
  });

  it("uses protocol_fee_bps and the asset's revenue_split_bps", () => {
    const a = OPERATIONAL[0];
    const s = revenueSplitOf(a.id);
    expect(s.feeBps).toBe(protocolConfig.protocolFeeBps);
    expect(s.splitBps).toBe(a.revenueSplitBps);
    expect(s.fee).toBe(Math.round((s.gross * s.feeBps) / 10_000));
    // the investor leg is what feeds the lazy index
    expect(s.investor).toBe(Math.round(((s.gross - s.fee) * s.splitBps) / 10_000));
  });

  it("operational assets actually deposited revenue (gross > 0)", () => {
    for (const a of OPERATIONAL) {
      if ((a.accumulator?.lifetimeInvestorRevenue ?? 0) > 0) {
        expect(revenueSplitOf(a.id).gross).toBeGreaterThan(0);
      }
    }
  });
});

describe("governance history ordering (§18.3 event-only log)", () => {
  const hist = governanceHistory();

  it("is sorted newest-first", () => {
    for (let i = 1; i < hist.length; i++) {
      expect(hist[i - 1].tsMs).toBeGreaterThanOrEqual(hist[i].tsMs);
    }
  });

  it("includes genesis, param changes, treasury rotation and a pause incident", () => {
    const kinds = new Set(hist.map((h) => h.kind));
    expect(kinds.has("init")).toBe(true);
    expect(kinds.has("param")).toBe(true);
    expect(kinds.has("treasury")).toBe(true);
    expect(kinds.has("pause")).toBe(true);
    expect(kinds.has("resume")).toBe(true);
  });

  it("every entry carries a resolvable tx digest", () => {
    for (const h of hist) expect(h.txDigest.startsWith("0x")).toBe(true);
  });
});

describe("token page supply identity (MI-1)", () => {
  it("every accumulator maps to an asset and minted == wrapped + unwrapped == goal", () => {
    const FUNDED = new Set<AssetState>(["FUNDED", "EXECUTING", "OPERATIONAL", "DEFAULTED", "COMPENSATING", "CLOSED"]);
    for (const a of assets) {
      if (!a.accumulator) continue;
      expect(assetByAccId[a.accumulator.id]?.id).toBe(a.id);
      const s = supplyOf(a.id);
      expect(s.minted).toBe(s.wrapped + s.unwrapped);
      if (FUNDED.has(a.state)) expect(s.minted).toBe(a.fundingGoal);
    }
  });

  it("assetById and assetByAccId agree on the accumulator", () => {
    for (const a of assets) {
      if (!a.accumulator) continue;
      expect(assetByAccId[a.accumulator.id]).toBe(assetById[a.id]);
    }
  });
});
