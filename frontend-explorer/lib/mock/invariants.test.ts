// FE-M1 mock-invariant suite (explorer_spec.md §5.4). The most important tests
// in the frontend track: they prove the fixture is a self-consistent picture of
// a running protocol, not arbitrary numbers. If one fails, the mock is wrong.

import { describe, it, expect } from "vitest";
import type { AssetState, EventType } from "../types";
import { assets, validators, disputes, DEMO_WALLET, portfolio } from "./data";
import { holdersOf, holdingsOf, supplyOf } from "./holders";
import { accountByAddr } from "./accounts";
import { allEvents, txList } from "./activity";
import { resolveObject } from "./registry";
import { legalDocsOf, proofsOf, evidenceOf } from "./documents";

const FUNDED = new Set<AssetState>(["FUNDED", "EXECUTING", "OPERATIONAL", "DEFAULTED", "COMPENSATING", "CLOSED"]);
const fundedAssets = assets.filter((a) => FUNDED.has(a.state));

describe("MI-1  Σ(deeds + wrapped) == total_minted == funding_goal", () => {
  for (const a of fundedAssets) {
    it(`${a.id} (${a.state})`, () => {
      const ledger = holdersOf(a.id);
      const minted = a.accumulator?.totalMintedShares ?? a.fundingGoal;
      const sum = ledger.reduce((s, h) => s + h.shareCount + h.wrapped, 0);
      expect(sum).toBe(minted);
      expect(minted).toBe(a.fundingGoal);
    });
  }
});

describe("MI-2  Σ wrapped == accumulator.total_wrapped_shares", () => {
  for (const a of fundedAssets) {
    it(`${a.id}`, () => {
      const wrapped = holdersOf(a.id).reduce((s, h) => s + h.wrapped, 0);
      expect(wrapped).toBe(a.accumulator?.totalWrappedShares ?? 0);
    });
  }
});

describe("MI-1b  every holder holds ≥1 share and wrapped ≤ total", () => {
  for (const a of fundedAssets) {
    it(`${a.id}`, () => {
      for (const h of holdersOf(a.id)) {
        expect(h.shareCount + h.wrapped).toBeGreaterThanOrEqual(1);
        expect(h.wrapped).toBeLessThanOrEqual(h.shareCount + h.wrapped);
        expect(h.wrapped).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

describe("MI-3  raise accounting", () => {
  it("raised ≤ funding_goal for every asset", () => {
    for (const a of assets) expect(a.raised).toBeLessThanOrEqual(a.fundingGoal);
  });
  it("finalized assets are fully raised (raised == goal)", () => {
    for (const a of fundedAssets) expect(a.raised).toBe(a.fundingGoal);
  });
  it("raise series ends exactly at raised", () => {
    for (const a of assets) {
      if (!a.raiseSeries.length) continue;
      expect(a.raiseSeries[a.raiseSeries.length - 1].v).toBe(a.raised);
    }
  });
});

describe("MI-4  index series monotone non-decreasing", () => {
  for (const a of assets) {
    if (!a.accumulator) continue;
    it(`${a.id}`, () => {
      const s = a.indexSeries;
      for (let i = 1; i < s.length; i++) expect(s[i].v).toBeGreaterThanOrEqual(s[i - 1].v);
      expect(a.accumulator!.cumulativeIndex).toBeGreaterThanOrEqual(0);
    });
  }
});

describe("MI-5  every event actor resolves to an account", () => {
  it("no orphan actor addresses", () => {
    for (const e of allEvents) {
      if (!e.actor) continue;
      const acc = accountByAddr(e.actor);
      expect(acc.address).toBe(e.actor);
      expect(acc.roles.length).toBeGreaterThan(0);
    }
  });
});

describe("MI-6  every referenced id resolves via the registry", () => {
  it("assets, accumulators, pools, disputes resolve", () => {
    for (const a of assets) expect(resolveObject(a.id)).not.toBeNull();
    for (const a of assets) if (a.accumulator) expect(resolveObject(a.accumulator.id)?.kind).toBe("token");
    for (const v of validators) expect(resolveObject(v.poolId)?.kind).toBe("validator");
    for (const d of disputes) expect(resolveObject(d.id)?.kind).toBe("dispute");
  });
  it("every event txDigest and actor resolves", () => {
    for (const e of allEvents) {
      expect(resolveObject(e.txDigest)?.kind).toBe("tx");
      if (e.actor) expect(resolveObject(e.actor)).not.toBeNull();
    }
  });
  it("every holder address resolves to an account route", () => {
    for (const a of fundedAssets) {
      for (const h of holdersOf(a.id)) {
        const ref = resolveObject(h.address);
        expect(ref?.kind).toBe("account");
        expect(ref?.route).toBe(`/address/${h.address}`);
      }
    }
  });
});

describe("coverage: data completeness", () => {
  it("every AssetState has ≥1 asset", () => {
    const states: AssetState[] = [
      "PENDING_VOUCH", "FUNDING", "FUNDED", "EXECUTING", "OPERATIONAL",
      "DEFAULTED", "COMPENSATING", "CLOSED", "FAILED", "CANCELLED",
    ];
    for (const s of states) expect(assets.some((a) => a.state === s), `missing ${s}`).toBe(true);
  });

  it("every EventType appears ≥1× in the stream", () => {
    const types: EventType[] = [
      "AssetCreated", "AssetVouched", "AssetStateChanged", "AssetCancelled",
      "MilestoneProofSubmitted", "MilestoneApproved", "TrancheReleased", "AssetOperational",
      "EntityDefaulted", "AssetClosed", "CapitalContributed", "ContributionRefunded",
      "SharesClaimed", "SharesWrapped", "SharesUnwrapped", "ShareRedeemed", "YieldClaimed",
      "RaiseFinalized", "RaiseAborted", "RevenueDeposited", "RolloverSwept", "CompensationSwept",
      "ValidatorRegistered", "StakeAdded", "StakeWithdrawn", "ValidatorStatusChanged",
      "DisputeOpened", "JurorVoted", "DisputeResolved",
      "ProtocolInitialized", "ProtocolParamChanged", "ProtocolTreasuryChanged",
      "EmergencyStopTriggered", "ProtocolResumed",
    ];
    const seen = new Set(allEvents.map((e) => e.type));
    for (const t of types) expect(seen.has(t), `missing event ${t}`).toBe(true);
  });

  it("coverageLocked is real (>0 for vouched, 0 for unvouched)", () => {
    for (const a of assets) {
      if (a.state === "PENDING_VOUCH" || a.state === "CANCELLED") expect(a.coverageLocked).toBe(0);
      else expect(a.coverageLocked).toBeGreaterThan(0);
    }
  });
});

describe("transactions: event grouping", () => {
  it("at least some transactions group multiple events", () => {
    const multi = txList().filter((t) => t.events.length > 1);
    expect(multi.length).toBeGreaterThan(0);
  });
  it("every event belongs to exactly one resolvable tx", () => {
    const digests = new Set(txList().map((t) => t.digest));
    for (const e of allEvents) expect(digests.has(e.txDigest)).toBe(true);
  });
});

describe("selectors", () => {
  it("holdersOf is ranked by total holding desc", () => {
    for (const a of fundedAssets) {
      const l = holdersOf(a.id);
      for (let i = 1; i < l.length; i++) {
        expect(l[i - 1].shareCount + l[i - 1].wrapped).toBeGreaterThanOrEqual(l[i].shareCount + l[i].wrapped);
      }
    }
  });

  it("holdingsOf(DEMO_WALLET) matches the portfolio deeds/wrapped", () => {
    const holdings = holdingsOf(DEMO_WALLET);
    for (const pos of portfolio) {
      const h = holdings.find((x) => x.assetId === pos.assetId);
      expect(h, `demo missing ${pos.assetId}`).toBeTruthy();
      expect(h!.shareCount).toBe(pos.deeds);
      expect(h!.wrapped).toBe(pos.wrapped);
    }
  });

  it("supplyOf: minted = wrapped + unwrapped", () => {
    for (const a of fundedAssets) {
      const s = supplyOf(a.id);
      expect(s.minted).toBe(s.wrapped + s.unwrapped);
    }
  });
});

describe("documents", () => {
  it("vouched assets have legal docs; unvouched do not", () => {
    for (const a of assets) {
      const docs = legalDocsOf(a.id);
      if (a.state === "PENDING_VOUCH" || a.state === "CANCELLED") expect(docs.length).toBe(0);
      else expect(docs.length).toBeGreaterThan(0);
    }
  });
  it("approved/released tranches have a proof; pending do not", () => {
    for (const a of assets) {
      const proofs = proofsOf(a.id);
      const approvedCount = a.tranches.filter((t) => t.released || t.approvedBy).length;
      expect(proofs.length).toBe(approvedCount);
    }
  });
  it("every dispute has sha256-pinned evidence", () => {
    for (const d of disputes) {
      const ev = evidenceOf(d.id);
      expect(ev).toBeTruthy();
      expect(ev!.sha256.startsWith("0x")).toBe(true);
      expect(ev!.attestedBy).toBe(d.challenger);
    }
  });
});
