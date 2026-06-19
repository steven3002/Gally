import { describe, it, expect, vi } from "vitest";

// FE-M8b — the owned-object → `Position` mapper (`buildConnectedHoldings`). The
// `ObjectReader` seam lets us drive the accumulator read deterministically; the asset
// metadata comes from the data seam, mocked here to a controlled asset so the test does
// not couple to a specific mock fixture.
vi.mock("@/lib/data", () => ({
  data: {
    getAsset: async (id: string) =>
      id === "0xasset"
        ? {
            id,
            name: "Test Asset",
            ticker: "TST",
            category: "Energy",
            state: "OPERATIONAL",
            accumulator: { id: "0xacc", tokenSymbol: "gTST", cumulativeIndex: 0, apy: 9.5, wrappingFrozen: true },
          }
        : null,
  },
}));

import { buildConnectedHoldings, pendingYield, type ObjectReader, type OwnedDeed } from "./position";

const RAW_HALF = BigInt(500_000_000_000_000); // indexHumanFromRaw → 0.5 USDC/share
const TOKEN = "0xpkg::gally_entity_1::GALLY_ENTITY_1";

const reader: ObjectReader = {
  async getObject() {
    return {
      data: {
        type: `0xpkg::accumulator::GlobalYieldAccumulator<${TOKEN}>`,
        content: { dataType: "moveObject", fields: { cumulative_yield_index: RAW_HALF.toString() } },
      },
    };
  },
};

describe("buildConnectedHoldings (owned-object → Position)", () => {
  it("groups deeds by asset, resolves claimable + wrapped, and carries metadata", async () => {
    const deeds: OwnedDeed[] = [
      { objectId: "0xd1", assetId: "0xasset", shareCount: 60, shareCountMicro: BigInt(60_000_000), shareIndexRaw: BigInt(0) },
      { objectId: "0xd2", assetId: "0xasset", shareCount: 40, shareCountMicro: BigInt(40_000_000), shareIndexRaw: BigInt(0) },
    ];
    const balances = new Map<string, bigint>([[TOKEN, BigInt(50_000_000)]]); // 50 wrapped Coin<T>
    const out = await buildConnectedHoldings(reader, "0xme", deeds, balances);

    expect(out).toHaveLength(1);
    const h = out[0];
    expect(h.shareCount).toBe(100); // 60 + 40 grouped under the asset
    expect(h.wrapped).toBe(50); // Coin<T> μ→human
    expect(h.assetName).toBe("Test Asset");
    expect(h.tokenSymbol).toBe("gTST");
    expect(h.frozen).toBe(true);
    // claimable = Σ per-deed pendingYield(rawIndex, deedIndex=0, count) = 0.5·100 = 50
    const expected =
      pendingYield(RAW_HALF, BigInt(0), BigInt(60_000_000)) + pendingYield(RAW_HALF, BigInt(0), BigInt(40_000_000));
    expect(h.pendingYield).toBeCloseTo(expected, 9);
    expect(h.pendingYield).toBeCloseTo(50, 6);
  });

  it("degrades to zero claimable/wrapped when the asset/accumulator is unknown", async () => {
    const deeds: OwnedDeed[] = [
      { objectId: "0xd3", assetId: "0xunknown", shareCount: 10, shareCountMicro: BigInt(10_000_000), shareIndexRaw: BigInt(0) },
    ];
    const out = await buildConnectedHoldings(reader, "0xme", deeds, new Map());
    expect(out).toHaveLength(1);
    expect(out[0].shareCount).toBe(10);
    expect(out[0].pendingYield).toBe(0);
    expect(out[0].wrapped).toBe(0);
    expect(out[0].state).toBe("OPERATIONAL"); // fallback metadata
  });
});
