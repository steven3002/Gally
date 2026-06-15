// FE-M2 unit tests: the resolveObject routing table (every id kind) and the
// searchAll filter that backs ⌘K + /search. Pairs with the e2e routing/search
// specs (resolution.spec.ts) and MI-6 in invariants.test.ts.

import { describe, it, expect } from "vitest";
import { resolveObject, routeForId, searchAll } from "./registry";
import { assets, validators, disputes, protocolConfig } from "./data";

describe("resolveObject routing table (FE-M2)", () => {
  it("resolves every object kind to its canonical route", () => {
    const a = assets[0];
    expect(resolveObject(a.id)).toMatchObject({ kind: "asset", route: `/assets/${a.id}` });

    const vouched = assets.find((x) => x.accumulator);
    expect(resolveObject(vouched!.accumulator!.id)?.kind).toBe("token");

    expect(resolveObject(validators[0].poolId)).toMatchObject({
      kind: "validator",
      route: `/validators/${validators[0].poolId}`,
    });
    expect(resolveObject(disputes[0].id)?.kind).toBe("dispute");
    expect(resolveObject(protocolConfig.configId)?.kind).toBe("config");
    expect(resolveObject("0x" + "a".repeat(40))?.kind).toBe("account");
  });

  it("returns null for an unknown non-address id", () => {
    expect(resolveObject("not-a-real-object")).toBeNull();
    expect(resolveObject("")).toBeNull();
  });

  it("routeForId falls back to /objects/:id for unknown ids, real route otherwise", () => {
    expect(routeForId("not-a-real-object")).toBe("/objects/not-a-real-object");
    expect(routeForId(assets[0].id)).toBe(`/assets/${assets[0].id}`);
  });
});

describe("searchAll filter (FE-M2)", () => {
  it("returns nothing for an empty/blank query", () => {
    expect(searchAll("")).toEqual([]);
    expect(searchAll("   ")).toEqual([]);
  });

  it("finds an asset by name and by ticker", () => {
    const a = assets[0];
    expect(searchAll(a.name).some((r) => r.kind === "asset" && r.id === a.id)).toBe(true);
    expect(searchAll(a.ticker).some((r) => r.id === a.id)).toBe(true);
  });

  it("finds a validator by name", () => {
    const v = validators[0];
    expect(searchAll(v.name).some((r) => r.kind === "validator" && r.id === v.poolId)).toBe(true);
  });

  it("resolves an exact pasted id to that entity", () => {
    const a = assets[0];
    expect(searchAll(a.id).some((r) => r.id === a.id)).toBe(true);
  });

  it("ranks assets ahead of other kinds in the result list", () => {
    const res = searchAll("a");
    const kinds = res.map((r) => r.kind);
    const firstAsset = kinds.indexOf("asset");
    const firstNonAsset = kinds.findIndex((k) => k !== "asset");
    if (firstAsset !== -1 && firstNonAsset !== -1) {
      expect(firstAsset).toBeLessThan(firstNonAsset);
    }
  });
});
