import { describe, it, expect } from "vitest";
import {
  usdc,
  intOf,
  indexHuman,
  stateOfByte,
  categoryOfInt,
  validatorStatusOfByte,
  type WireAsset,
  type WireDispute,
  type WireValidatorDetail,
  type WireHolder,
  type WireGovEvent,
} from "./wire";
import { deriveState, mapAsset, mapDispute, mapValidator, mapHolder, mapGovEvent } from "./map";
import { eventTypeOf, eventFeedOf } from "./events";

describe("wire numeric decoders (string u64/u128 → number, no precision loss)", () => {
  it("usdc divides μUSDC by 1e6", () => {
    expect(usdc("100000000000")).toBe(100_000);
    expect(usdc("500000000")).toBe(500);
    expect(usdc("0")).toBe(0);
    expect(usdc(null)).toBe(0);
    expect(usdc("")).toBe(0);
  });
  it("usdc is BigInt-safe past 2^53", () => {
    // 9_007_199_254_740_993 μUSDC — beyond f64 integer range; divided result is exact-ish.
    expect(usdc("9007199254740993000000")).toBeCloseTo(9_007_199_254_740_993, -3);
  });
  it("usdc rejects garbage", () => {
    expect(usdc("0xabc")).toBe(0);
    expect(usdc("12.5")).toBe(0);
  });
  it("intOf parses plain counts", () => {
    expect(intOf("3")).toBe(3);
    expect(intOf(7)).toBe(7);
    expect(intOf(null)).toBe(0);
  });
  it("indexHuman unscales SCALE(1e9)·μ(1e6)", () => {
    expect(indexHuman("1000000000000000")).toBe(1); // 1e15 / 1e9 / 1e6
    expect(indexHuman(null)).toBe(0);
  });
});

describe("enum decoders (authoritative asset.move/validator.move bytes)", () => {
  it("state bytes", () => {
    expect(stateOfByte(0)).toBe("PENDING_VOUCH");
    expect(stateOfByte(1)).toBe("FUNDING");
    expect(stateOfByte(2)).toBe("FAILED");
    expect(stateOfByte(3)).toBe("CANCELLED");
    expect(stateOfByte(4)).toBe("EXECUTING");
    expect(stateOfByte(5)).toBe("OPERATIONAL");
    expect(stateOfByte(6)).toBe("COMPENSATING");
    expect(stateOfByte(7)).toBe("CLOSED");
  });
  it("category ints (LI-D4)", () => {
    expect(categoryOfInt(0)).toBe("Housing");
    expect(categoryOfInt(2)).toBe("Trade Finance");
    expect(categoryOfInt(5)).toBe("Infrastructure");
  });
  it("validator status bytes", () => {
    expect(validatorStatusOfByte(0)).toBe("ACTIVE");
    expect(validatorStatusOfByte(1)).toBe("FROZEN");
    expect(validatorStatusOfByte(2)).toBe("SLASHED");
  });
});

describe("Tier-5 derived state (FUNDED/DEFAULTED labels)", () => {
  it("FUNDING + fully subscribed → FUNDED", () => {
    expect(deriveState("FUNDING", 100, 100, false)).toBe("FUNDED");
    expect(deriveState("FUNDING", 60, 100, false)).toBe("FUNDING");
    expect(deriveState("FUNDING", 0, 0, false)).toBe("FUNDING");
  });
  it("EXECUTING/OPERATIONAL + default flag → DEFAULTED", () => {
    expect(deriveState("OPERATIONAL", 100, 100, true)).toBe("DEFAULTED");
    expect(deriveState("EXECUTING", 100, 100, true)).toBe("DEFAULTED");
  });
  it("never fabricates a label without inputs", () => {
    expect(deriveState("OPERATIONAL", 100, 100, false)).toBe("OPERATIONAL");
    expect(deriveState("COMPENSATING", 100, 100, false)).toBe("COMPENSATING");
  });
});

const wireAsset: WireAsset = {
  asset_id: "0xa",
  entity: "0xe",
  goal: "100000000000",
  funding_deadline_ms: 4102444800000,
  tranche_count: 3,
  revenue_split_bps: 7000,
  collateral: "10000000000",
  validator_pool_id: "0xp",
  coverage: "20000000000",
  accumulator_id: "0xacc",
  current_state: 5,
  close_reason: null,
  created_at_ms: 1781847251577,
  name: "Lagos Solar",
  ticker: "LSM",
  category: 4,
  location: "Lagos, NG",
  entity_name: "BrightPower",
  metadata_blob_id: "deadbeef",
  metadata_sha256: "01020304",
  is_term_financing: true,
  return_target: "130000000000",
  apy: 12.5,
  accumulator: { reward_pool: "47000000", rollover_reserve: "5000000", compensation_pool: null, compensation_unlock_ms: null, wrapping_frozen: false },
};

describe("mapAsset", () => {
  it("maps the core fields with correct units", () => {
    const a = mapAsset(wireAsset);
    expect(a.id).toBe("0xa");
    expect(a.name).toBe("Lagos Solar");
    expect(a.ticker).toBe("LSM");
    expect(a.category).toBe("Energy");
    expect(a.state).toBe("OPERATIONAL");
    expect(a.fundingGoal).toBe(100_000);
    expect(a.entityCollateral).toBe(10_000);
    expect(a.coverageLocked).toBe(20_000);
    expect(a.revenueSplitBps).toBe(7000);
    expect(a.isTermFinancing).toBe(true);
    expect(a.returnTarget).toBe(130_000);
    expect(a.raised).toBe(100_000); // OPERATIONAL ⇒ raise complete
    expect(a.accumulator?.apy).toBe(12.5);
    expect(a.accumulator?.rewardPool).toBe(47);
  });
  it("FUNDING base + extras.raised drives the FUNDED label", () => {
    const a = mapAsset({ ...wireAsset, current_state: 1 }, { raised: 100_000 });
    expect(a.state).toBe("FUNDED");
  });
  it("tolerates null metadata (pre-M8 asset)", () => {
    const a = mapAsset({ ...wireAsset, name: null, ticker: null, category: null, entity_name: null });
    expect(a.name).toContain("Asset ");
    expect(a.category).toBe("Housing");
  });
});

describe("mapValidator / mapDispute / mapHolder / mapGovEvent", () => {
  it("maps a validator with track record", () => {
    const detail: WireValidatorDetail = {
      pool_id: "0xp",
      validator: "0xv",
      initial_stake: "300000000000",
      current_status: 1,
      registered_at_ms: 100,
      name: "Sentinel",
      reputation: 72,
      stake_events: [],
      status_changes: [],
      track_record: { assets_vouched: 6, milestones_approved: 4, disputes_against: 2, disputes_upheld: 1, coverage_locked: "20000000000", active_vouches: 3 },
    };
    const v = mapValidator(detail, detail);
    expect(v.name).toBe("Sentinel");
    expect(v.status).toBe("FROZEN");
    expect(v.stake).toBe(300_000);
    expect(v.locked).toBe(20_000);
    expect(v.activeVouches).toBe(3);
    expect(v.assetsVouched).toBe(6);
    expect(v.milestonesApproved).toBe(4);
    expect(v.reputation).toBe(72);
  });
  it("maps a dispute (OPEN when verdict null; UPHELD/REJECTED otherwise)", () => {
    const base: WireDispute = {
      dispute_id: "0xd",
      asset_id: "0xa",
      target_pool_id: "0xp",
      challenger: "0xc",
      bond: "1000000000",
      evidence_hash: "ev",
      reason: "Forged proof",
      opened_at_ms: 1,
      verdict: null,
      votes_guilty: 2,
      votes_innocent: 1,
      slashed: null,
      bounty: null,
    };
    expect(mapDispute(base).status).toBe("OPEN");
    expect(mapDispute(base).bond).toBe(1000);
    expect(mapDispute(base).reason).toBe("Forged proof");
    expect(mapDispute({ ...base, verdict: 1, slashed: "5000000000", bounty: "500000000" }).status).toBe("UPHELD");
    expect(mapDispute({ ...base, verdict: 0 }).status).toBe("REJECTED");
  });
  it("maps a holder ledger entry", () => {
    const h: WireHolder = { address: "0xh", share_count: "500000000", wrapped: "100000000", pct_of_supply: "6.00", acquired_at_ms: 9, yield_claimed_index: "1000000000000000" };
    const e = mapHolder(h);
    expect(e.shareCount).toBe(500);
    expect(e.wrapped).toBe(100);
    expect(e.yieldClaimedIndex).toBe(1);
  });
  it("maps a governance param change", () => {
    const g: WireGovEvent = { timestamp_ms: 5, event_type: "ProtocolParamChanged", tx_digest: "0xt", config_id: null, admin: null, param_name: "challenger_bond", old_value: "1000000000", new_value: "2000000000", old_treasury: null, new_treasury: null };
    const c = mapGovEvent(g);
    expect(c.name).toBe("challenger_bond");
    expect(c.oldValue).toBe("1000000000");
    expect(c.newValue).toBe("2000000000");
  });
});

describe("event-type/feed decoding", () => {
  it("strips the Event suffix and assigns feeds", () => {
    expect(eventTypeOf("CapitalContributedEvent")).toBe("CapitalContributed");
    expect(eventTypeOf("DisputeResolvedEvent")).toBe("DisputeResolved");
    expect(eventFeedOf("CapitalContributed")).toBe("position");
    expect(eventFeedOf("DisputeResolved")).toBe("dispute");
    expect(eventFeedOf("RevenueDeposited")).toBe("revenue");
    expect(eventFeedOf("ValidatorRegistered")).toBe("validator");
  });
});

describe("source selector defaults to mock (offline-safe)", async () => {
  it("data.kind is mock unless NEXT_PUBLIC_DATA_SOURCE=live", async () => {
    const { data, DATA_SOURCE } = await import("./index");
    expect(DATA_SOURCE).toBe("mock");
    expect(data.kind).toBe("mock");
  });
});
