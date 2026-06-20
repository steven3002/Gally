"use client";

// A persistent "Take tour" control in the topbar so ANYONE — first-time or returning,
// on any browser — can (re)start the guided tour at will. This decouples the tour from
// the first-run gating (which keys off the wallet's on-chain state, so a wallet that
// already claimed/holds USDC would otherwise never see it again). The tour is CONTEXTUAL:
// it explains whatever page you're on (asset page → asset tour, portfolio → portfolio
// tour, …). Shown from `lg` up, where the desktop sidebar (overview tour) is visible.

import { usePathname } from "next/navigation";
import { useTour } from "./Tour";
import { tourForPath } from "./tourSteps";
import { Compass } from "@/components/ui/icons";

export function TakeTourButton() {
  const { start, active } = useTour();
  const pathname = usePathname();
  return (
    <button
      onClick={() => start(tourForPath(pathname))}
      disabled={active}
      title="Take a guided tour of this page"
      aria-label="Take a guided tour of this page"
      className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-[11px] font-bold text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50 lg:inline-flex"
    >
      <Compass className="h-4 w-4" /> Take tour
    </button>
  );
}
