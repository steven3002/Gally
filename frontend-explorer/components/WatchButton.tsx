"use client";

import { Star, StarFilled } from "@/components/ui/icons";
import { useWatchlist } from "@/lib/watchlist";
import { cn } from "@/lib/format";

export function WatchButton({
  assetId,
  className,
  size = "h-4 w-4",
}: {
  assetId: string;
  className?: string;
  size?: string;
}) {
  const { has, toggle, hydrated } = useWatchlist();
  const active = hydrated && has(assetId);

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(assetId);
      }}
      aria-label={active ? "Remove from watchlist" : "Add to watchlist"}
      className={cn(
        "rounded-lg p-1.5 transition-colors",
        active ? "text-warning" : "text-muted-2 hover:text-foreground",
        className,
      )}
    >
      {active ? <StarFilled className={size} /> : <Star className={size} />}
    </button>
  );
}
