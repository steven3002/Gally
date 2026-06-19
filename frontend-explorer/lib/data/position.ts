"use client";

// FE-M8b — Wallet-RPC owned-object reads (the connected wallet's live `Position`).
//
// These facts are deliberately NOT indexed (guard rails R3/R8: secondary transfers
// emit no events, so only a direct owned-object read is authoritative). We read the
// connected wallet's `GallyShare` deeds + `Coin<T>` balances by type, and compute the
// lazy-index claimable yield. The mock `portfolio` selector stays the source until a
// wallet is connected; this hook overlays the live truth when it is.

import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { GALLY_PACKAGE_ID } from "@/lib/tx/config";
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

export interface OwnedDeed {
  objectId: string;
  assetId: string;
  shareCount: number;
  shareIndexRaw: bigint;
}

/** The connected wallet's owned `GallyShare` deeds (live). Inert when disconnected. */
export function useOwnedDeeds(): { deeds: OwnedDeed[]; isLoading: boolean } {
  const account = useCurrentAccount();
  const { data, isLoading } = useSuiClientQuery(
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
    return [
      {
        objectId: o.data!.objectId,
        assetId: String(f.asset_id ?? ""),
        shareCount: Number(BigInt((f.share_count as string) ?? "0")) / MICRO,
        shareIndexRaw: BigInt((f.yield_claimed_index as string) ?? "0"),
      },
    ];
  });

  return { deeds, isLoading };
}
