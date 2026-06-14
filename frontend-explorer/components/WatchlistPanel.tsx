"use client";

import Link from "next/link";
import { useWatchlist } from "@/lib/watchlist";
import { assetById, assets } from "@/lib/mock/data";
import { AssetMini } from "@/components/asset/AssetCard";
import { Star } from "@/components/ui/icons";

export function WatchlistPanel() {
  const { ids, hydrated } = useWatchlist();
  const watched = ids.map((id) => assetById[id]).filter(Boolean);

  // before hydration, render nothing visual-shifting; show a stable skeleton
  const suggestions = assets
    .filter((a) => a.state === "OPERATIONAL" || a.state === "FUNDING")
    .slice(0, 3);

  return (
    <div className="px-2 pb-2">
      {!hydrated ? (
        <div className="space-y-2 p-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      ) : watched.length > 0 ? (
        <div className="space-y-0.5">
          {watched.map((a) => (
            <AssetMini key={a.id} asset={a} />
          ))}
        </div>
      ) : (
        <div className="px-2 py-4 text-center">
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-warning-soft text-warning">
            <Star className="h-4 w-4" />
          </div>
          <p className="text-xs font-medium text-foreground">Your watchlist is empty</p>
          <p className="mt-1 text-[11px] text-muted">
            Tap the star on any asset to track it here.
          </p>
          <div className="mt-3 space-y-0.5 border-t border-border pt-2 text-left">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
              Suggested
            </p>
            {suggestions.map((a) => (
              <AssetMini key={a.id} asset={a} />
            ))}
          </div>
        </div>
      )}
      <Link
        href="/assets"
        className="mt-2 block rounded-xl border border-dashed border-border py-2 text-center text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary"
      >
        Browse all assets
      </Link>
    </div>
  );
}
