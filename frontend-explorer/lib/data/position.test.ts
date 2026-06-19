import { describe, it, expect } from "vitest";
import { pendingYield, claimableHuman, indexHumanFromRaw } from "./position";

// FE-M8b — claimable math for the connected wallet's owned-object `Position`.
// SCALE = 1e9 (u128 index), MICRO = 1e6 (μUSDC / μ-shares). A raw index of
// 0.5e9*1e6 = 5e14 means "0.5 USDC of lifetime yield per (human) share".
const RAW_HALF = BigInt(500_000_000_000_000); // indexHumanFromRaw → 0.5
const MICRO = BigInt(1_000_000);

describe("indexHumanFromRaw", () => {
  it("unscales a raw u128 index to human USDC/share", () => {
    expect(indexHumanFromRaw(RAW_HALF)).toBeCloseTo(0.5, 9);
    expect(indexHumanFromRaw(BigInt(0))).toBe(0);
  });
});

describe("pendingYield (raw lazy-index)", () => {
  it("computes (currentIndex − shareIndex)·count in USDC", () => {
    // 0.5 USDC/share accrued, 1 human share (1e6 μ-shares) ⇒ 0.5 USDC.
    expect(pendingYield(RAW_HALF, BigInt(0), MICRO)).toBeCloseTo(0.5, 9);
    // 10 shares ⇒ 5 USDC.
    expect(pendingYield(RAW_HALF, BigInt(0), BigInt(10) * MICRO)).toBeCloseTo(5, 9);
  });

  it("is zero when the deed index is at/above the current index, or count is 0", () => {
    expect(pendingYield(RAW_HALF, RAW_HALF, MICRO)).toBe(0);
    expect(pendingYield(BigInt(0), RAW_HALF, MICRO)).toBe(0);
    expect(pendingYield(RAW_HALF, BigInt(0), BigInt(0))).toBe(0);
  });
});

describe("claimableHuman", () => {
  it("multiplies the index delta by the (human) share count", () => {
    expect(claimableHuman(0.5, 0.1, 100)).toBeCloseTo(40, 9);
    expect(claimableHuman(0.5, 0, 1)).toBeCloseTo(0.5, 9);
  });

  it("clamps to ≥0 and is zero with no shares", () => {
    expect(claimableHuman(0.1, 0.5, 100)).toBe(0); // never went backwards
    expect(claimableHuman(0.5, 0.1, 0)).toBe(0);
  });

  it("agrees with the raw pendingYield path", () => {
    // raw: 0.5 USDC/share, 10 shares ⇒ 5; human: same.
    expect(claimableHuman(indexHumanFromRaw(RAW_HALF), 0, 10)).toBeCloseTo(
      pendingYield(RAW_HALF, BigInt(0), BigInt(10) * MICRO),
      9,
    );
  });
});
