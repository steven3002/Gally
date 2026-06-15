// FE-M7.2 unit tests: the transaction execution seam — intent validation,
// metadata helpers, the deterministic mock digest, and the lifecycle reducer.
// Pure/node-safe (no DOM); the bell + action flows are covered by e2e.

import { describe, it, expect } from "vitest";
import {
  INTENT_ENTRY,
  intentRoute,
  intentTone,
  intentVerb,
  validateIntent,
  type TxIntent,
} from "./intents";
import { executeIntent, mockDigest } from "./executor";
import type { TxStatus } from "./types";

const contribute: TxIntent = { kind: "contribute", assetId: "asset01", assetName: "A", amount: 500 };
const claim: TxIntent = { kind: "claim_rewards", assetId: "asset01", assetName: "A", amount: 42 };
const dispute: TxIntent = { kind: "raise_dispute", poolId: "0xvalpool", validatorName: "V", assetId: "asset01", bond: 25_000 };

describe("validateIntent", () => {
  it("passes valid intents", () => {
    expect(validateIntent(contribute)).toBeNull();
    expect(validateIntent(claim)).toBeNull();
    expect(validateIntent(dispute)).toBeNull();
    expect(validateIntent({ kind: "crank", crank: "resolve_dispute", targetId: "disp01", label: "Resolve dispute" })).toBeNull();
  });

  it("rejects non-positive amounts / bonds with a reason", () => {
    expect(validateIntent({ ...contribute, amount: 0 })).toBeTruthy();
    expect(validateIntent({ ...claim, amount: 0 })).toBeTruthy();
    expect(validateIntent({ ...dispute, bond: 0 })).toBeTruthy();
  });
});

describe("intent metadata", () => {
  it("maps every kind to a Move entry, verb, route, and tone", () => {
    expect(INTENT_ENTRY.contribute).toContain("contribute_capital");
    expect(intentVerb(claim)).toBe("Claim yield");
    expect(intentRoute(contribute)).toBe("/assets/asset01");
    expect(intentRoute(dispute)).toBe("/validators/0xvalpool");
    expect(intentTone(claim)).toBe("positive");
  });
});

describe("mockDigest", () => {
  it("is deterministic and well-formed (0x + 32 hex)", () => {
    expect(mockDigest(contribute)).toBe(mockDigest(contribute));
    expect(mockDigest(contribute)).toMatch(/^0x[0-9a-f]{32}$/);
  });
  it("differs for different intents", () => {
    expect(mockDigest(contribute)).not.toBe(mockDigest(claim));
  });
});

describe("executeIntent lifecycle", () => {
  it("drives building → signing → pending → success and returns the digest", async () => {
    const steps: TxStatus[] = [];
    const res = await executeIntent(contribute, { instant: true, onStep: (l) => steps.push(l.status) });
    expect(steps).toEqual(["building", "signing", "pending", "success"]);
    expect(res).toEqual({ ok: true, digest: mockDigest(contribute) });
  });

  it("fails fast on an invalid intent (no signing)", async () => {
    const steps: TxStatus[] = [];
    const res = await executeIntent({ ...contribute, amount: 0 }, { instant: true, onStep: (l) => steps.push(l.status) });
    expect(steps).toEqual(["error"]);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("surfaces a post-signature failure when forced", async () => {
    const steps: TxStatus[] = [];
    const res = await executeIntent(claim, { instant: true, forceError: true, onStep: (l) => steps.push(l.status) });
    expect(steps).toEqual(["building", "signing", "error"]);
    expect(res.ok).toBe(false);
  });
});
