"use client";

// FE-M8b — Wallet-RPC owned-object reads (the connected wallet's live `Position`).
//
// These facts are deliberately NOT indexed (guard rails R3/R8: secondary transfers
// emit no events, so only a direct owned-object read is authoritative). We read the
// connected wallet's `GallyShare` deeds + `Coin<T>` balances by type, and compute the
// lazy-index claimable yield. The mock `portfolio` selector stays the source until a
// wallet is connected; this hook overlays the live truth when it is.

import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import type { AssetState, Holding } from "@/lib/types";
import { GALLY_PACKAGE_ID } from "@/lib/tx/config";
import { tokenTypeFromAccumulatorType } from "@/lib/tx/resolve";
import { data } from "@/lib/data";
import { INDEX_SCALE, MICRO } from "./wire";

/**
 * Pending (accrued-unclaimed) yield on a deed: `(currentIndex − shareIndex) · count`.
 * Indices are the raw u128 (scaled by SCALE=1e9); count is μ-shares. Result in USDC.
 * Pure + unit-tested.
 */
export function pendingYield(currentIndexRaw: bigint, shareIndexRaw: bigint, countMicro: bigint): number {
  if (currentIndexRaw <= shareIndexRaw || countMicro <= BigInt(0)) return 0;
  const deltaScaled = (currentIndexRaw - shareIndexRaw) * countMicro; // scaled μ²USDC
  // unscale SCALE, then one MICRO for the index-per-share, then μ→USDC.
  return Number(deltaScaled / BigInt(INDEX_SCALE)) / MICRO / MICRO;
}

/** A raw u128 deed index (bigint) → human "USDC of lifetime yield per share". */
export function indexHumanFromRaw(raw: bigint): number {
  return Number(raw) / INDEX_SCALE / MICRO;
}

/**
 * Human-units claimable on a deed: `(cumIndexHuman − shareIndexHuman)·shareCount`,
 * clamped ≥0. Matches the indexer's `cumulativeIndex`/`yieldClaimedIndex` units (both
 * `indexHuman`) and the mock `solvencyOf`, so the connected wallet's claimable agrees
 * with the rest of the app. Pure + unit-tested.
 */
export function claimableHuman(cumIndexHuman: number, shareIndexHuman: number, shareCount: number): number {
  const delta = cumIndexHuman - shareIndexHuman;
  return delta > 0 && shareCount > 0 ? delta * shareCount : 0;
}

export interface OwnedDeed {
  objectId: string;
  assetId: string;
  /** Human shares (μ-unscaled). */
  shareCount: number;
  /** Raw μ-shares (for exact lazy-index math). */
  shareCountMicro: bigint;
  shareIndexRaw: bigint;
}

/** The connected wallet's owned `GallyShare` deeds (live). Inert when disconnected. */
export function useOwnedDeeds(): { deeds: OwnedDeed[]; isLoading: boolean; refetch: () => void } {
  const account = useCurrentAccount();
  const { data, isLoading, refetch } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: account?.address ?? "",
      filter: GALLY_PACKAGE_ID ? { StructType: `${GALLY_PACKAGE_ID}::share::GallyShare` } : undefined,
      options: { showContent: true, showType: true },
    },
    { enabled: !!account },
  );

  const deeds: OwnedDeed[] = (data?.data ?? []).flatMap((o) => {
    const content = o.data?.content;
    if (!content || content.dataType !== "moveObject") return [];
    const f = content.fields as Record<string, unknown>;
    const micro = BigInt((f.share_count as string) ?? "0");
    return [
      {
        objectId: o.data!.objectId,
        assetId: String(f.asset_id ?? ""),
        shareCount: Number(micro) / MICRO,
        shareCountMicro: micro,
        shareIndexRaw: BigInt((f.yield_claimed_index as string) ?? "0"),
      },
    ];
  });

  return { deeds, isLoading, refetch: () => void refetch() };
}

/**
 * The connected wallet's coin balances, keyed by full coin type. Entity tokens
 * (`Coin<T>`) are the wrapped, yield-suspended positions; matched to an asset by the
 * `<T>` read from that asset's accumulator. Inert when disconnected.
 */
export function useOwnedCoinBalances(): { balances: Map<string, bigint>; isLoading: boolean; refetch: () => void } {
  const account = useCurrentAccount();
  const { data, isLoading, refetch } = useSuiClientQuery("getAllBalances", { owner: account?.address ?? "" }, { enabled: !!account });
  const balances = new Map<string, bigint>();
  for (const b of data ?? []) {
    try {
      balances.set(b.coinType, BigInt(b.totalBalance));
    } catch {
      /* skip unparsable balance */
    }
  }
  return { balances, isLoading, refetch: () => void refetch() };
}

/** A soulbound `ContributionReceipt` (asset.move): owned until the raise resolves. */
export interface OwnedReceipt {
  objectId: string;
  assetId: string;
  /** Human USDC contributed == future deed count (μ-unscaled). */
  amount: number;
}

/**
 * The connected wallet's owned `ContributionReceipt`s (live). These are minted on
 * `contribute` and burned on `claim_shares`/`refund_contribution`, so — like deeds —
 * they're a wallet-RPC owned-object read, not indexed. Inert when disconnected.
 */
export function useOwnedReceipts(): { receipts: OwnedReceipt[]; isLoading: boolean; refetch: () => void } {
  const account = useCurrentAccount();
  const { data, isLoading, refetch } = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: account?.address ?? "",
      filter: GALLY_PACKAGE_ID ? { StructType: `${GALLY_PACKAGE_ID}::asset::ContributionReceipt` } : undefined,
      options: { showContent: true, showType: true },
    },
    { enabled: !!account },
  );

  const receipts: OwnedReceipt[] = (data?.data ?? []).flatMap((o) => {
    const content = o.data?.content;
    if (!content || content.dataType !== "moveObject") return [];
    const f = content.fields as Record<string, unknown>;
    return [
      {
        objectId: o.data!.objectId,
        assetId: String(f.asset_id ?? ""),
        amount: Number(BigInt((f.amount as string) ?? "0")) / MICRO,
      },
    ];
  });

  return { receipts, isLoading, refetch: () => void refetch() };
}

/** A receipt joined to its asset's name + current lifecycle state (for the UI + actions). */
export interface ReceiptView {
  objectId: string;
  assetId: string;
  assetName: string;
  amount: number;
  state: AssetState;
}

/**
 * Join owned receipts to their asset metadata (name + state) via the data seam, so the
 * portfolio can render each receipt and offer the right action (claim deeds once
 * finalized, refund if it failed). Pure given the seam; bounded by the wallet's receipts.
 */
export async function buildReceiptViews(receipts: OwnedReceipt[]): Promise<ReceiptView[]> {
  const out: ReceiptView[] = [];
  for (const r of receipts) {
    const asset = await data.getAsset(r.assetId).catch(() => null);
    out.push({
      objectId: r.objectId,
      assetId: r.assetId,
      assetName: asset?.name ?? r.assetId.slice(0, 10),
      amount: r.amount,
      state: asset?.state ?? "FUNDING",
    });
  }
  return out;
}

/* ------------------------------------------------ owned-object → Position mapper */

/** A live holding carries the asset's wrap-freeze flag (for the unwrap gate). */
export type LiveHolding = Holding & { frozen: boolean };

/** The slice of the Sui client `buildConnectedHoldings` needs (decouples it from dapp-kit for tests). */
export interface ObjectReader {
  getObject(input: { id: string; options?: { showType?: boolean; showContent?: boolean } }): Promise<{
    data?: { type?: string | null; content?: { dataType?: string; fields?: unknown } | null } | null;
  }>;
}

/**
 * Build the connected wallet's `Holding[]` from its owned objects:
 * - deeds grouped by asset (sum of `share_count`);
 * - claimable = Σ per-deed `(currentIndex − deedIndex)·count` against the LIVE
 *   accumulator index, read straight from the accumulator object (raw u128);
 * - wrapped = the owned `Coin<T>` balance, T resolved from the accumulator's type.
 *
 * Asset metadata (name/state/apy/…) comes from the indexer via the data seam. The
 * owned-object facts (deeds, balances, the deed's stored index) are the wallet-RPC
 * truth that is deliberately NOT indexed. Pure (given the reader) + unit-tested.
 */
export async function buildConnectedHoldings(client: ObjectReader, address: string, deeds: OwnedDeed[], balances: Map<string, bigint>): Promise<LiveHolding[]> {
  const byAsset = new Map<string, OwnedDeed[]>();
  for (const d of deeds) {
    const arr = byAsset.get(d.assetId) ?? [];
    arr.push(d);
    byAsset.set(d.assetId, arr);
  }

  const out: LiveHolding[] = [];
  for (const [assetId, ds] of byAsset) {
    const asset = await data.getAsset(assetId).catch(() => null);
    const accId = asset?.accumulator?.id;

    let rawIndex = BigInt(0);
    let tokenType: string | undefined;
    if (accId) {
      try {
        const o = await client.getObject({ id: accId, options: { showType: true, showContent: true } });
        tokenType = tokenTypeFromAccumulatorType(o.data?.type ?? undefined);
        const c = o.data?.content;
        if (c && c.dataType === "moveObject") {
          rawIndex = BigInt(((c.fields as Record<string, unknown>).cumulative_yield_index as string) ?? "0");
        }
      } catch {
        /* accumulator unreadable → claimable stays 0, wrapped stays 0 */
      }
    }

    const shareCount = ds.reduce((s, d) => s + d.shareCount, 0);
    const claimable = ds.reduce((s, d) => s + pendingYield(rawIndex, d.shareIndexRaw, d.shareCountMicro), 0);
    const wrapped = tokenType ? Number(balances.get(tokenType) ?? BigInt(0)) / MICRO : 0;

    out.push({
      address,
      shareCount,
      wrapped,
      acquiredAtMs: 0,
      yieldClaimedIndex: 0,
      assetId,
      assetName: asset?.name ?? assetId.slice(0, 10),
      ticker: asset?.ticker ?? "—",
      tokenSymbol: asset?.accumulator?.tokenSymbol,
      category: asset?.category ?? "Housing",
      state: asset?.state ?? "OPERATIONAL",
      apy: asset?.accumulator?.apy ?? 0,
      pendingYield: claimable,
      frozen: asset?.accumulator?.wrappingFrozen ?? false,
    });
  }
  return out;
}
