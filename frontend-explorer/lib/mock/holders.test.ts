// FE-M3 unit tests: the holder-distribution selector (per-asset % of supply +
// ranking) and role detection. Pairs with the holders/address e2e specs and the
// MI-1 supply invariant in invariants.test.ts.

import { describe, it, expect } from "vitest";
import type { AccountRole, AssetState } from "../types";
import { assets } from "./data";
import { holderDistribution, holdingsOf } from "./holders";
import { accountByAddr, accountsByRole } from "./accounts";

const FUNDED = new Set<AssetState>(["FUNDED", "EXECUTING", "OPERATIONAL", "DEFAULTED", "COMPENSATING", "CLOSED"]);
const fundedAssets = assets.filter((a) => FUNDED.has(a.state));

describe("holderDistribution (FE-M3)", () => {
  for (const a of fundedAssets) {
    it(`${a.id}: % of supply sums to ~100`, () => {
      const dist = holderDistribution(a.id);
      const sum = dist.reduce((s, h) => s + h.pctOfSupply, 0);
      expect(sum).toBeCloseTo(100, 4); // ±dust
    });
  }

  it("is ranked descending and total == deeds + wrapped", () => {
    for (const a of fundedAssets) {
      const dist = holderDistribution(a.id);
      for (let i = 1; i < dist.length; i++) {
        expect(dist[i - 1].total).toBeGreaterThanOrEqual(dist[i].total);
      }
      for (const h of dist) expect(h.total).toBe(h.shareCount + h.wrapped);
    }
  });

  it("returns no holders for a not-yet-finalized asset", () => {
    const funding = assets.find((a) => a.state === "FUNDING");
    expect(funding && holderDistribution(funding.id).length).toBe(0);
  });
});

describe("role detection (FE-M3)", () => {
  it("every protocol role is represented by ≥1 account", () => {
    const roles: AccountRole[] = ["investor", "entity", "validator", "challenger", "admin", "treasury"];
    for (const r of roles) expect(accountsByRole(r).length, r).toBeGreaterThan(0);
  });

  it("an asset's entity address carries the entity role", () => {
    for (const a of assets) expect(accountByAddr(a.entity).roles).toContain("entity");
  });

  it("a holder's address resolves as an investor", () => {
    const a = fundedAssets[0];
    const top = holderDistribution(a.id)[0];
    expect(accountByAddr(top.address).roles).toContain("investor");
    // and that holder's cross-asset holdings include this asset
    expect(holdingsOf(top.address).some((h) => h.assetId === a.id)).toBe(true);
  });
});
