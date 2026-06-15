// FE-M5 unit tests: the owed/solvency derivation (mirrors I-M2 / §15.4 over the
// fixture), the health ratio, and the default-risk days-to-deadline calc. Pairs
// with e2e/health.spec.ts (the holder-protection unwrap alert + countdowns).

import { describe, it, expect } from "vitest";
import type { AssetState } from "../types";
import { assets, assetById } from "./data";
import { holdersOf } from "./holders";
import { NOW, DAY } from "../format";
import { owedOf, solvencyOf, nextTrancheOf, graceOf, compensationLayersOf } from "./health";

const FUNDED = new Set<AssetState>(["FUNDED", "EXECUTING", "OPERATIONAL", "DEFAULTED", "COMPENSATING", "CLOSED"]);
const fundedAssets = assets.filter((a) => FUNDED.has(a.state));

describe("owed derivation (§15.4)", () => {
  it("owedOf == Σ (index − share.index)·count over unwrapped deeds", () => {
    for (const a of fundedAssets) {
      const cumIndex = a.accumulator?.cumulativeIndex ?? 0;
      const expected = holdersOf(a.id).reduce(
        (s, h) => s + Math.max(0, Math.round((cumIndex - h.yieldClaimedIndex) * h.shareCount)),
        0,
      );
      expect(owedOf(a.id)).toBe(expected);
    }
  });

  it("owed is 0 when the index has not moved", () => {
    for (const a of fundedAssets) {
      if ((a.accumulator?.cumulativeIndex ?? 0) === 0) expect(owedOf(a.id)).toBe(0);
    }
  });
});

describe("I-M2 solvency: reward_pool ≥ owed across the fixture (§15.4)", () => {
  for (const a of fundedAssets) {
    it(`${a.id} (${a.state})`, () => {
      const s = solvencyOf(a.id);
      expect(s.rewardPool).toBeGreaterThanOrEqual(s.owed);
      expect(s.healthy).toBe(true);
      expect(s.buffer).toBeGreaterThanOrEqual(0);
    });
  }

  it("ratio = reward_pool / owed (or Infinity when nothing is owed)", () => {
    for (const a of fundedAssets) {
      const s = solvencyOf(a.id);
      if (s.owed > 0) expect(s.ratio).toBeCloseTo(s.rewardPool / s.owed, 6);
      else expect(s.ratio).toBe(Infinity);
    }
  });
});

describe("default-risk: next-tranche deadline clock (§14)", () => {
  it("an EXECUTING asset's clock points at the first unreleased tranche", () => {
    const exec = assets.find((a) => a.state === "EXECUTING");
    expect(exec).toBeTruthy();
    const next = nextTrancheOf(exec!);
    const firstUnreleased = exec!.tranches.find((t) => !t.released)!;
    expect(next?.index).toBe(firstUnreleased.index);
    expect(next?.deadlineMs).toBe(firstUnreleased.deadlineMs);
    // days-to-deadline calc matches the timestamp
    expect(next?.daysLeft).toBe(Math.round((firstUnreleased.deadlineMs - NOW) / DAY));
    expect(next?.overdue).toBe(firstUnreleased.deadlineMs < NOW);
  });

  it("returns undefined when every tranche is released (e.g. operational)", () => {
    const op = assets.find((a) => a.state === "OPERATIONAL" && a.tranches.every((t) => t.released));
    if (op) expect(nextTrancheOf(op)).toBeUndefined();
  });

  it("risk escalates ok → soon → overdue by days left", () => {
    for (const a of assets) {
      const n = nextTrancheOf(a);
      if (!n) continue;
      if (n.overdue) expect(n.risk).toBe("overdue");
      else if (n.daysLeft <= 14) expect(n.risk).toBe("soon");
      else expect(n.risk).toBe("ok");
    }
  });
});

describe("compensation grace + restitution stack (§13/§14)", () => {
  it("a wrapping-frozen asset exposes a live grace deadline", () => {
    const comp = assetById["asset08"]; // COMPENSATING, wrapping_frozen
    const g = graceOf(comp);
    expect(g).toBeTruthy();
    expect(g!.unlockMs).toBe(comp.accumulator!.compensationUnlockMs);
    expect(g!.active).toBe(true); // frozen AND not yet elapsed
    expect(g!.daysLeft).toBeGreaterThan(0); // forward-looking countdown
  });

  it("the three-layer stack is escrow → validator → entity collateral", () => {
    const comp = assetById["asset12"]; // DEFAULTED
    const { layers, pool } = compensationLayersOf(comp);
    expect(layers.map((l) => l.label)).toEqual([
      "Undeployed escrow",
      "Validator coverage",
      "Entity collateral",
    ]);
    expect(layers[0].amount).toBe(
      comp.tranches.filter((t) => !t.released).reduce((s, t) => s + t.amount, 0),
    );
    expect(layers[2].amount).toBe(comp.entityCollateral);
    expect(pool).toBe(comp.accumulator!.compensationPool);
  });

  it("non-frozen assets have no grace window", () => {
    expect(graceOf(assetById["asset01"])).toBeUndefined(); // OPERATIONAL
  });
});
