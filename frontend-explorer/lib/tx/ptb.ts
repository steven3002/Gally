// FE-M8b — Programmable-Transaction-Block builders.
//
// Two layers:
//  1. `buildPlan(intent, ctx)` — a PURE, unit-testable description of the moveCall(s)
//     an intent compiles to: target, type-args, and ordered argument descriptors. The
//     arg order + type-args are transcribed 1:1 from `gally_core/sources/*.move` (R2,
//     same discipline the bot uses). No SDK here, so it tests without a chain.
//  2. `planToTransaction(plan, ctx)` — turns a plan into a real `@mysten/sui`
//     `Transaction` (coin splits, shared/owned objects, the 0x6 clock, pure args, and
//     transferring returned objects to the sender).
//
// Amounts in intents are human units; on-chain everything is 6-decimal μ (USDC and
// shares alike, 1 share == 1 USDC of principal), so we scale by MICRO here.

import { Transaction } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import type { CrankKind, TxIntent } from "./intents";

export const MICRO = 1_000_000;

export interface AssetCtx {
  assetId: string;
  accumulatorId?: string;
  validatorPoolId?: string;
  /** Fully-qualified entity Coin<T> type tag, e.g. `0xPKG::gally_entity_1::GALLY_ENTITY_1`. */
  tokenType?: string;
}

export interface OwnedRefs {
  receiptId?: string; // ContributionReceipt — claim_shares / refund
  shareId?: string; // GallyShare — claim_rewards / wrap / split
  coinTId?: string; // Coin<T> — unwrap
  usdcCoinId?: string; // Coin<USDC> — contribute / dispute bond
}

export interface BuildCtx {
  packageId: string;
  configId: string;
  sender: string;
  asset?: AssetCtx;
  owned?: OwnedRefs;
  disputeId?: string;
}

export type PlanArg =
  | { kind: "shared"; id: string; mutable: boolean }
  | { kind: "owned"; id: string }
  | { kind: "clock" }
  // `enc` controls how a vector<u8> value is byte-encoded: "utf8" (default — the
  // string's bytes) or "hex" (decode a hex string to raw bytes, e.g. a 32-byte sha256).
  | { kind: "pure"; ty: "u64" | "vector<u8>"; value: number | string; enc?: "utf8" | "hex" }
  | { kind: "coin"; coinType: "USDC" | "T"; amountMicro: number }
  | { kind: "result"; from: number }; // result of an earlier call in the plan

export interface MoveCallPlan {
  target: string;
  typeArguments: string[];
  args: PlanArg[];
}

export interface TxPlan {
  calls: MoveCallPlan[];
  /** Transfer all objects returned by the last call to the sender. */
  transferLast: boolean;
}

class BuildError extends Error {}

function need<T>(v: T | undefined | null, what: string): T {
  if (v == null) throw new BuildError(`live tx: ${what} is unresolved`);
  return v;
}

function tokenTypeOf(ctx: BuildCtx): string {
  return need(ctx.asset?.tokenType, "entity token type <T>");
}

const CRANK_TARGET: Record<CrankKind, string> = {
  resolve_dispute: "dispute::resolve_dispute",
  flag_default: "asset::check_default",
  abort_failed_raise: "asset::abort_failed_raise",
  sweep_rollover: "accumulator::sweep_rollover",
  sweep_compensation: "accumulator::sweep_compensation",
};

/** Pure: the moveCall plan an intent compiles to. Throws BuildError if a ref is missing. */
export function buildPlan(intent: TxIntent, ctx: BuildCtx): TxPlan {
  const pkg = ctx.packageId;
  const t = (m: string) => `${pkg}::${m}`;
  const assetId = () => need(ctx.asset?.assetId, "asset id");
  const accId = () => need(ctx.asset?.accumulatorId, "accumulator id");
  const config = (): PlanArg => ({ kind: "shared", id: ctx.configId, mutable: false });
  const clock = (): PlanArg => ({ kind: "clock" });

  switch (intent.kind) {
    case "contribute":
      return {
        transferLast: true, // Coin<USDC> change
        calls: [
          {
            target: t("asset::contribute_capital"),
            typeArguments: [],
            args: [
              { kind: "shared", id: assetId(), mutable: true },
              config(),
              clock(),
              { kind: "coin", coinType: "USDC", amountMicro: Math.round(intent.amount * MICRO) },
            ],
          },
        ],
      };

    case "refund":
      return {
        transferLast: true, // Coin<USDC>
        calls: [
          {
            target: t("asset::refund_contribution"),
            typeArguments: [],
            args: [
              { kind: "shared", id: assetId(), mutable: true },
              config(),
              { kind: "owned", id: need(ctx.owned?.receiptId, "ContributionReceipt id") },
            ],
          },
        ],
      };

    case "claim_shares":
      return {
        transferLast: true, // GallyShare
        calls: [
          {
            target: t("asset::claim_shares"),
            typeArguments: [tokenTypeOf(ctx)],
            args: [
              { kind: "shared", id: assetId(), mutable: false },
              { kind: "shared", id: accId(), mutable: false },
              config(),
              { kind: "owned", id: need(ctx.owned?.receiptId, "ContributionReceipt id") },
              clock(),
            ],
          },
        ],
      };

    case "claim_rewards":
      return {
        transferLast: true, // Coin<USDC>
        calls: [
          {
            target: t("accumulator::claim_rewards"),
            typeArguments: [tokenTypeOf(ctx)],
            args: [
              { kind: "shared", id: accId(), mutable: true },
              { kind: "owned", id: need(ctx.owned?.shareId, "GallyShare id") },
            ],
          },
        ],
      };

    case "wrap":
      return {
        transferLast: true, // (Coin<T>, Coin<USDC>)
        calls: [
          {
            target: t("accumulator::wrap_shares"),
            typeArguments: [tokenTypeOf(ctx)],
            args: [
              { kind: "shared", id: accId(), mutable: true },
              config(),
              { kind: "owned", id: need(ctx.owned?.shareId, "GallyShare id") },
              clock(),
            ],
          },
        ],
      };

    case "unwrap":
      return {
        transferLast: true, // GallyShare
        calls: [
          {
            target: t("accumulator::unwrap_coins"),
            typeArguments: [tokenTypeOf(ctx)],
            args: [
              { kind: "shared", id: accId(), mutable: true },
              { kind: "coin", coinType: "T", amountMicro: Math.round(intent.amount * MICRO) },
              clock(),
            ],
          },
        ],
      };

    case "split":
      return {
        transferLast: true, // new GallyShare
        calls: [
          {
            target: t("share::split_share"),
            typeArguments: [],
            args: [
              { kind: "owned", id: need(ctx.owned?.shareId, "GallyShare id") },
              { kind: "pure", ty: "u64", value: Math.round(intent.amount * MICRO) },
            ],
          },
        ],
      };

    case "raise_dispute": {
      // Evidence is a real Walrus ref when the challenger attached a file (blob id +
      // its sha256, hashed in-browser); otherwise an empty ref (reason-only dispute).
      const evidence: MoveCallPlan = {
        target: t("asset::new_walrus_ref"),
        typeArguments: [],
        args: [
          { kind: "pure", ty: "vector<u8>", value: intent.evidenceBlobId ?? "" },
          { kind: "pure", ty: "vector<u8>", value: intent.evidenceSha256 ?? "", enc: "hex" },
        ],
      };
      const dispute: MoveCallPlan = {
        target: t("dispute::initialize_dispute"),
        typeArguments: [tokenTypeOf(ctx)],
        args: [
          { kind: "shared", id: assetId(), mutable: true },
          { kind: "shared", id: intent.poolId, mutable: true },
          { kind: "shared", id: accId(), mutable: false },
          config(),
          { kind: "coin", coinType: "USDC", amountMicro: Math.round(intent.bond * MICRO) },
          { kind: "result", from: 0 }, // the WalrusRef
          { kind: "pure", ty: "vector<u8>", value: intent.reason ?? "Challenged via explorer" },
          clock(),
        ],
      };
      return { transferLast: false, calls: [evidence, dispute] };
    }

    case "crank": {
      const target = t(CRANK_TARGET[intent.crank]);
      const ty = ctx.asset?.tokenType ? [ctx.asset.tokenType] : [];
      switch (intent.crank) {
        case "sweep_rollover":
          return { transferLast: false, calls: [{ target, typeArguments: ty, args: [{ kind: "shared", id: accId(), mutable: true }] }] };
        case "sweep_compensation":
          return { transferLast: false, calls: [{ target, typeArguments: ty, args: [{ kind: "shared", id: accId(), mutable: true }, clock()] }] };
        case "abort_failed_raise":
          return {
            transferLast: false,
            calls: [{ target, typeArguments: [], args: [{ kind: "shared", id: assetId(), mutable: true }, { kind: "shared", id: need(ctx.asset?.validatorPoolId, "validator pool id"), mutable: true }, config(), clock()] }],
          };
        case "resolve_dispute":
          return {
            transferLast: false,
            calls: [
              {
                target,
                typeArguments: [tokenTypeOf(ctx)],
                args: [
                  { kind: "shared", id: need(ctx.disputeId ?? intent.targetId, "dispute id"), mutable: true },
                  { kind: "shared", id: need(ctx.asset?.validatorPoolId, "validator pool id"), mutable: true },
                  { kind: "shared", id: assetId(), mutable: true },
                  { kind: "shared", id: accId(), mutable: true },
                  config(),
                  clock(),
                ],
              },
            ],
          };
        case "flag_default":
          return {
            transferLast: false,
            calls: [{ target, typeArguments: [], args: [{ kind: "shared", id: assetId(), mutable: true }, { kind: "shared", id: need(ctx.asset?.validatorPoolId, "validator pool id"), mutable: true }, config(), clock()] }],
          };
      }
    }
  }
}

/** Decode a hex string (optional `0x`, odd length left-padded) into raw bytes. */
function hexBytes(hex: string): number[] {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const clean = h.length % 2 ? "0" + h : h;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

/** Compile a plan into a real Transaction (live executor). */
export function planToTransaction(plan: TxPlan, ctx: BuildCtx): Transaction {
  const tx = new Transaction();
  const results: ReturnType<Transaction["moveCall"]>[] = [];

  const resolveArg = (a: PlanArg) => {
    switch (a.kind) {
      case "shared":
      case "owned":
        return tx.object(a.id);
      case "clock":
        return tx.object(SUI_CLOCK_OBJECT_ID);
      case "pure": {
        if (a.ty === "u64") return tx.pure.u64(BigInt(a.value));
        const bytes =
          a.enc === "hex"
            ? hexBytes(String(a.value))
            : Array.from(new TextEncoder().encode(String(a.value)));
        return tx.pure.vector("u8", bytes);
      }
      case "coin": {
        const srcId = a.coinType === "USDC" ? ctx.owned?.usdcCoinId : ctx.owned?.coinTId;
        const [c] = tx.splitCoins(tx.object(need(srcId, `${a.coinType} coin id`)), [a.amountMicro]);
        return c;
      }
      case "result":
        return results[a.from];
    }
  };

  plan.calls.forEach((call) => {
    const ret = tx.moveCall({ target: call.target, typeArguments: call.typeArguments, arguments: call.args.map(resolveArg) });
    results.push(ret);
  });

  if (plan.transferLast) {
    tx.transferObjects([results[results.length - 1]], tx.pure.address(ctx.sender));
  }
  return tx;
}
