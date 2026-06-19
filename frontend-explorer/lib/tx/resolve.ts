// FE-M8b — Live owned-object / type resolver for the PTB builders.
//
// `buildPlan` (ptb.ts) needs concrete object ids the intent itself doesn't carry:
// the asset's accumulator id + validator pool, the entity Coin type <T>, and the
// connected wallet's OWNED objects (ContributionReceipt / GallyShare / Coin<T> /
// Coin<USDC>). Those owned facts are deliberately NOT indexed (guard rails R3/R8 —
// secondary transfers emit no events), so we read them straight from the wallet RPC,
// and pull the derived/historical context (accumulator id, pool id) from the indexer.
//
// Anything that can't be resolved is simply left undefined; `buildPlan` then throws a
// clear "…unresolved" error the executor surfaces — never a wrong transaction.

import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { TxIntent } from "./intents";
import type { ResolvedRefs } from "./buildCtx";
import { GALLY_PACKAGE_ID, USDC_TYPE } from "./config";
import { data } from "@/lib/data";

/**
 * Extract the entity token type `<T>` from an accumulator object's Move type string,
 * e.g. `0xPKG::accumulator::YieldAccumulator<0xPKG::gally_entity_1::GALLY_ENTITY_1>`
 * → `0xPKG::gally_entity_1::GALLY_ENTITY_1`. Pure + unit-tested.
 */
export function tokenTypeFromAccumulatorType(t: string | null | undefined): string | undefined {
  if (!t) return undefined;
  const lt = t.indexOf("<");
  const gt = t.lastIndexOf(">");
  if (lt < 0 || gt < 0 || gt <= lt) return undefined;
  return t.slice(lt + 1, gt).trim() || undefined;
}

const RECEIPT_TYPE = () => `${GALLY_PACKAGE_ID}::asset::ContributionReceipt`;
const SHARE_TYPE = () => `${GALLY_PACKAGE_ID}::share::GallyShare`;

/** First owned object of `structType` whose `asset_id` field matches (or any, if assetId omitted). */
async function findOwned(client: SuiJsonRpcClient, owner: string, structType: string, assetId?: string): Promise<string | undefined> {
  try {
    const res = await client.getOwnedObjects({ owner, filter: { StructType: structType }, options: { showContent: true } });
    for (const o of res.data) {
      const c = o.data?.content;
      if (!c || c.dataType !== "moveObject") continue;
      const f = c.fields as Record<string, unknown>;
      if (!assetId || String(f.asset_id ?? "") === assetId) return o.data?.objectId;
    }
  } catch {
    /* RPC unreachable → leave unresolved */
  }
  return undefined;
}

/** First coin object id of `coinType` owned by `owner`. */
async function firstCoin(client: SuiJsonRpcClient, owner: string, coinType: string): Promise<string | undefined> {
  if (!coinType) return undefined;
  try {
    const res = await client.getCoins({ owner, coinType });
    return res.data[0]?.coinObjectId;
  } catch {
    return undefined;
  }
}

/** Read the entity token type <T> from the accumulator object's on-chain type. */
async function tokenTypeOfAccumulator(client: SuiJsonRpcClient, accId: string | undefined): Promise<string | undefined> {
  if (!accId) return undefined;
  try {
    const o = await client.getObject({ id: accId, options: { showType: true } });
    return tokenTypeFromAccumulatorType(o.data?.type ?? undefined);
  } catch {
    return undefined;
  }
}

/**
 * Resolve everything the PTB builder needs for `intent`, fetching only what that verb
 * requires. The indexer supplies derived ids (accumulator/pool); the wallet RPC
 * supplies the sender's owned objects + the token type.
 */
export async function resolveLiveRefs(client: SuiJsonRpcClient, intent: TxIntent, sender: string): Promise<ResolvedRefs> {
  const r: ResolvedRefs = {};

  // --- Determine the subject asset (and dispute, for resolve_dispute) ---
  let assetId: string | undefined;
  if (intent.kind === "crank") {
    if (intent.crank === "resolve_dispute") {
      const d = await data.getDispute(intent.targetId).catch(() => null);
      r.disputeId = intent.targetId;
      assetId = d?.assetId;
      r.validatorPoolId = d?.targetPoolId;
    } else if (intent.crank === "sweep_rollover" || intent.crank === "sweep_compensation") {
      r.accumulatorId = intent.targetId; // the crank subject IS the accumulator
    } else {
      assetId = intent.targetId; // flag_default / abort_failed_raise act on the asset
    }
  } else {
    assetId = intent.assetId;
    if (intent.kind === "raise_dispute") r.validatorPoolId = intent.poolId;
  }

  // --- Pull asset-derived ids from the indexer (accumulator + pool) ---
  if (assetId) {
    r.assetId = assetId;
    const asset = await data.getAsset(assetId).catch(() => null);
    if (asset) {
      r.accumulatorId = r.accumulatorId ?? asset.accumulator?.id;
      r.validatorPoolId = r.validatorPoolId ?? (asset.validatorPoolId || undefined);
    }
  }

  // --- The entity token type <T> from the accumulator object (for the <T> verbs) ---
  const needsToken =
    intent.kind === "claim_shares" ||
    intent.kind === "claim_rewards" ||
    intent.kind === "wrap" ||
    intent.kind === "unwrap" ||
    intent.kind === "raise_dispute" ||
    (intent.kind === "crank" && (intent.crank === "sweep_rollover" || intent.crank === "sweep_compensation" || intent.crank === "resolve_dispute"));
  if (needsToken) r.tokenType = await tokenTypeOfAccumulator(client, r.accumulatorId);

  // --- The sender's owned objects, per verb ---
  switch (intent.kind) {
    case "contribute":
      r.usdcCoinId = await firstCoin(client, sender, USDC_TYPE);
      break;
    case "refund":
    case "claim_shares":
      r.receiptId = await findOwned(client, sender, RECEIPT_TYPE(), assetId);
      break;
    case "claim_rewards":
    case "wrap":
    case "split":
      r.shareId = await findOwned(client, sender, SHARE_TYPE(), assetId);
      break;
    case "unwrap":
      r.coinTId = await firstCoin(client, sender, r.tokenType ?? "");
      break;
    case "raise_dispute":
      r.usdcCoinId = await firstCoin(client, sender, USDC_TYPE);
      break;
  }

  return r;
}
