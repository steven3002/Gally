// FE-M7.2 unit tests: permissionless crank eligibility is derived from real fixture
// state and mirrors the Move preconditions 1:1 (so the UI never offers a call the
// contract would abort), plus the optimistic-reconciliation key mapping.

import { describe, it, expect } from "vitest";
import { assetById, disputes } from "./data";
import { NOW } from "../format";
import {
  cranksForAsset,
  cranksForAccumulator,
  cranksForDispute,
  allCranks,
  type CrankOp,
} from "./cranks";
import { optimisticKey, type TxIntent } from "../tx/intents";

const find = (ops: CrankOp[], crank: string) => ops.find((o) => o.crank === crank);

describe("sweep_rollover (rollover_reserve > 0 AND unwrapped supply > 0)", () => {
  it("is eligible where a funded rollover has unwrapped holders", () => {
    const op = find(cranksForAccumulator(assetById["asset02"]), "sweep_rollover");
    expect(op).toBeTruthy();
    expect(op!.eligible).toBe(true); // rollover 3,100 + unwrapped supply
  });

  it("is not offered where the rollover reserve is zero", () => {
    expect(find(cranksForAccumulator(assetById["asset01"]), "sweep_rollover")).toBeUndefined();
  });
});

describe("sweep_compensation (now ≥ compensation_unlock_ms AND pool > 0)", () => {
  it("is eligible once the grace window has elapsed (asset12)", () => {
    const op = find(cranksForAccumulator(assetById["asset12"]), "sweep_compensation");
    expect(op).toBeTruthy();
    expect(op!.eligible).toBe(true);
    expect(NOW).toBeGreaterThanOrEqual(op!.availableAtMs!);
  });

  it("is gated while the grace window is still open (asset08)", () => {
    const op = find(cranksForAccumulator(assetById["asset08"]), "sweep_compensation");
    expect(op).toBeTruthy();
    expect(op!.eligible).toBe(false); // holders may still unwrap
    expect(op!.availableAtMs!).toBeGreaterThan(NOW);
  });
});

describe("flag_default (EXECUTING, next tranche deadline missed, unapproved)", () => {
  it("matches the first unreleased tranche's deadline", () => {
    const a = assetById["asset03"]; // EXECUTING
    const op = find(cranksForAsset(a), "flag_default");
    expect(op).toBeTruthy();
    const t = a.tranches.find((x) => !x.released)!;
    expect(op!.availableAtMs).toBe(t.deadlineMs);
    expect(op!.eligible).toBe(NOW > t.deadlineMs && !t.approvedBy);
  });
});

describe("abort_failed_raise (FUNDING, deadline passed, short of goal)", () => {
  it("is gated while the funding window is open (asset04)", () => {
    const a = assetById["asset04"]; // FUNDING, deadline in the future
    const op = find(cranksForAsset(a), "abort_failed_raise");
    expect(op).toBeTruthy();
    expect(op!.eligible).toBe(false);
    expect(op!.availableAtMs).toBe(a.fundingDeadlineMs);
  });
});

describe("resolve_dispute (OPEN, voting window elapsed)", () => {
  it("is only offered for OPEN disputes and gated until the deadline", () => {
    for (const d of disputes) {
      const ops = cranksForDispute(d);
      if (d.status !== "OPEN") {
        expect(ops).toHaveLength(0);
      } else {
        expect(ops[0].eligible).toBe(NOW >= d.votingDeadlineMs);
      }
    }
  });
});

describe("allCranks aggregate", () => {
  it("lists eligible cranks before pending ones", () => {
    const ops = allCranks();
    expect(ops.length).toBeGreaterThan(0);
    const firstPending = ops.findIndex((o) => !o.eligible);
    const lastEligible = ops.map((o) => o.eligible).lastIndexOf(true);
    if (firstPending !== -1) expect(lastEligible).toBeLessThan(firstPending);
  });

  it("has at least one runnable crank in the current fixture", () => {
    expect(allCranks().some((o) => o.eligible)).toBe(true);
  });

  it("every op maps to a real Move entry and a routable subject", () => {
    for (const o of allCranks()) {
      expect(o.entry).toMatch(/::/);
      expect(o.route).toMatch(/^\/(assets|tokens|disputes)\//);
    }
  });
});

describe("optimisticKey (verb, subject) mapping", () => {
  it("is stable and distinct per action+subject", () => {
    const claim: TxIntent = { kind: "claim_rewards", assetId: "asset01", assetName: "A", amount: 10 };
    const wrap: TxIntent = { kind: "wrap", assetId: "asset01", assetName: "A", amount: 5 };
    const crank: TxIntent = { kind: "crank", crank: "sweep_rollover", targetId: "acc02", label: "Sweep rollover" };
    expect(optimisticKey(claim)).toBe("claim:asset01");
    expect(optimisticKey(wrap)).toBe("wrap:asset01");
    expect(optimisticKey(crank)).toBe("crank:sweep_rollover:acc02");
    expect(optimisticKey(claim)).not.toBe(optimisticKey(wrap));
  });
});
