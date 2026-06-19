// FE-M8b — Assemble a `BuildCtx` for the live PTB builders from the env config, the
// connected sender, the intent's subject ids, and a `resolved` bag (accumulator id,
// entity token type <T>, and the sender's owned object ids) gathered from
// owned-object / object-proxy reads. Anything still missing makes `buildPlan` throw a
// clear "…unresolved" error the executor surfaces — never a wrong transaction.

import type { TxIntent } from "./intents";
import type { AssetCtx, BuildCtx, OwnedRefs } from "./ptb";
import { requireTxConfig } from "./config";

export interface ResolvedRefs extends Partial<AssetCtx>, OwnedRefs {
  disputeId?: string;
}

function subjectAssetId(intent: TxIntent): string | undefined {
  switch (intent.kind) {
    case "raise_dispute":
      return intent.assetId;
    case "crank":
      return intent.targetId; // best-effort; the resolver may override
    default:
      return intent.assetId;
  }
}

export function buildCtx(intent: TxIntent, sender: string, resolved: ResolvedRefs = {}): BuildCtx {
  const { packageId, configId } = requireTxConfig();
  const asset: AssetCtx = {
    assetId: resolved.assetId ?? subjectAssetId(intent) ?? "",
    accumulatorId: resolved.accumulatorId,
    validatorPoolId: resolved.validatorPoolId ?? (intent.kind === "raise_dispute" ? intent.poolId : undefined),
    tokenType: resolved.tokenType,
  };
  const owned: OwnedRefs = {
    receiptId: resolved.receiptId,
    shareId: resolved.shareId,
    coinTId: resolved.coinTId,
    usdcCoinId: resolved.usdcCoinId,
  };
  return {
    packageId,
    configId,
    sender,
    asset,
    owned,
    disputeId: resolved.disputeId ?? (intent.kind === "crank" && intent.crank === "resolve_dispute" ? intent.targetId : undefined),
  };
}
