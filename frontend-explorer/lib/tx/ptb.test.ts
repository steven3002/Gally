import { describe, it, expect } from "vitest";
import { buildPlan, MICRO, type BuildCtx } from "./ptb";
import { humanizeError } from "./executorLive";

const ctx: BuildCtx = {
  packageId: "0xPKG",
  configId: "0xCFG",
  sender: "0xME",
  asset: { assetId: "0xA", accumulatorId: "0xACC", validatorPoolId: "0xPOOL", tokenType: "0xPKG::tok::TOK" },
  owned: { receiptId: "0xRCPT", shareId: "0xSHARE", coinTId: "0xCOINT", usdcCoinId: "0xUSDC" },
  disputeId: "0xDISP",
};

const A = { assetId: "0xA", assetName: "Demo" };

describe("buildPlan — targets, type-args, and argument order match the Move signatures", () => {
  it("contribute_capital(asset, config, clock, Coin<USDC>)", () => {
    const plan = buildPlan({ kind: "contribute", ...A, amount: 500 }, ctx);
    expect(plan.calls).toHaveLength(1);
    const c = plan.calls[0];
    expect(c.target).toBe("0xPKG::asset::contribute_capital");
    expect(c.typeArguments).toEqual([]);
    expect(c.args.map((a) => a.kind)).toEqual(["shared", "shared", "clock", "coin"]);
    expect(c.args[0]).toMatchObject({ kind: "shared", id: "0xA", mutable: true });
    expect(c.args[1]).toMatchObject({ kind: "shared", id: "0xCFG", mutable: false });
    expect(c.args[3]).toMatchObject({ kind: "coin", coinType: "USDC", amountMicro: 500 * MICRO });
    expect(plan.transferLast).toBe(true);
  });

  it("claim_shares<T>(asset, acc, config, receipt, clock)", () => {
    const c = buildPlan({ kind: "claim_shares", ...A, amount: 100 }, ctx).calls[0];
    expect(c.target).toBe("0xPKG::asset::claim_shares");
    expect(c.typeArguments).toEqual(["0xPKG::tok::TOK"]);
    expect(c.args.map((a) => a.kind)).toEqual(["shared", "shared", "shared", "owned", "clock"]);
    expect(c.args[3]).toMatchObject({ kind: "owned", id: "0xRCPT" });
  });

  it("refund_contribution(asset, config, receipt) — no type args", () => {
    const c = buildPlan({ kind: "refund", ...A, amount: 1 }, ctx).calls[0];
    expect(c.target).toBe("0xPKG::asset::refund_contribution");
    expect(c.typeArguments).toEqual([]);
    expect(c.args.map((a) => a.kind)).toEqual(["shared", "shared", "owned"]);
  });

  it("claim_rewards<T>(acc, &mut share)", () => {
    const c = buildPlan({ kind: "claim_rewards", ...A, amount: 10 }, ctx).calls[0];
    expect(c.target).toBe("0xPKG::accumulator::claim_rewards");
    expect(c.typeArguments).toEqual(["0xPKG::tok::TOK"]);
    expect(c.args[0]).toMatchObject({ kind: "shared", id: "0xACC", mutable: true });
    expect(c.args[1]).toMatchObject({ kind: "owned", id: "0xSHARE" });
  });

  it("wrap_shares<T>(acc, config, share, clock)", () => {
    const c = buildPlan({ kind: "wrap", ...A, amount: 50 }, ctx).calls[0];
    expect(c.target).toBe("0xPKG::accumulator::wrap_shares");
    expect(c.args.map((a) => a.kind)).toEqual(["shared", "shared", "owned", "clock"]);
  });

  it("unwrap_coins<T>(acc, Coin<T>, clock)", () => {
    const c = buildPlan({ kind: "unwrap", ...A, amount: 30 }, ctx).calls[0];
    expect(c.target).toBe("0xPKG::accumulator::unwrap_coins");
    expect(c.args[1]).toMatchObject({ kind: "coin", coinType: "T", amountMicro: 30 * MICRO });
  });

  it("split_share(&mut share, amount: u64)", () => {
    const c = buildPlan({ kind: "split", ...A, amount: 25 }, ctx).calls[0];
    expect(c.target).toBe("0xPKG::share::split_share");
    expect(c.args[0]).toMatchObject({ kind: "owned", id: "0xSHARE" });
    expect(c.args[1]).toMatchObject({ kind: "pure", ty: "u64", value: 25 * MICRO });
  });

  it("initialize_dispute<T> nests new_walrus_ref and passes its result", () => {
    const plan = buildPlan({ kind: "raise_dispute", poolId: "0xPOOL", validatorName: "V", assetId: "0xA", bond: 1000 }, ctx);
    expect(plan.calls).toHaveLength(2);
    expect(plan.calls[0].target).toBe("0xPKG::asset::new_walrus_ref");
    const d = plan.calls[1];
    expect(d.target).toBe("0xPKG::dispute::initialize_dispute");
    expect(d.typeArguments).toEqual(["0xPKG::tok::TOK"]);
    // asset, pool, acc, config, bond(coin), result(walrusRef), reason(pure), clock
    expect(d.args.map((a) => a.kind)).toEqual(["shared", "shared", "shared", "shared", "coin", "result", "pure", "clock"]);
    expect(d.args[5]).toMatchObject({ kind: "result", from: 0 });
    expect(plan.transferLast).toBe(false);
  });

  it("cranks: sweep_rollover / sweep_compensation / resolve_dispute", () => {
    const roll = buildPlan({ kind: "crank", crank: "sweep_rollover", targetId: "0xACC", label: "Sweep rollover" }, ctx).calls[0];
    expect(roll.target).toBe("0xPKG::accumulator::sweep_rollover");
    expect(roll.args).toHaveLength(1);

    const comp = buildPlan({ kind: "crank", crank: "sweep_compensation", targetId: "0xACC", label: "Sweep compensation" }, ctx).calls[0];
    expect(comp.target).toBe("0xPKG::accumulator::sweep_compensation");
    expect(comp.args.map((a) => a.kind)).toEqual(["shared", "clock"]);

    const res = buildPlan({ kind: "crank", crank: "resolve_dispute", targetId: "0xDISP", label: "Resolve" }, ctx).calls[0];
    expect(res.target).toBe("0xPKG::dispute::resolve_dispute");
    expect(res.typeArguments).toEqual(["0xPKG::tok::TOK"]);
    // dispute, pool, asset, acc, config, clock
    expect(res.args.map((a) => a.kind)).toEqual(["shared", "shared", "shared", "shared", "shared", "clock"]);
  });
});

describe("buildPlan throws a clear error when a required ref is unresolved (never a wrong tx)", () => {
  const bare: BuildCtx = { packageId: "0xPKG", configId: "0xCFG", sender: "0xME", asset: { assetId: "0xA" }, owned: {} };
  it("claim_shares without a token type", () => {
    expect(() => buildPlan({ kind: "claim_shares", ...A, amount: 1 }, bare)).toThrow(/token type/i);
  });
  it("claim_rewards without an accumulator id", () => {
    const ctx2: BuildCtx = { ...bare, asset: { assetId: "0xA", tokenType: "0xT" } };
    expect(() => buildPlan({ kind: "claim_rewards", ...A, amount: 1 }, ctx2)).toThrow(/accumulator/i);
  });
  it("refund without a receipt", () => {
    expect(() => buildPlan({ kind: "refund", ...A, amount: 1 }, bare)).toThrow(/receipt/i);
  });
});

describe("humanizeError", () => {
  it("maps a MoveAbort to a readable message with the code", () => {
    expect(humanizeError(new Error("...MoveAbort(MoveLocation {...}, 300) in command 0"))).toMatch(/aborted by the contract \(code 300\)/);
  });
  it("maps a wallet rejection", () => {
    expect(humanizeError(new Error("User rejected the request"))).toMatch(/rejected in wallet/i);
  });
  it("passes through our own unresolved-ref BuildError", () => {
    expect(humanizeError(new Error("live tx: entity token type <T> is unresolved"))).toMatch(/unresolved/);
  });
});
