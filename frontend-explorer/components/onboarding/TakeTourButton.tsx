"use client";

// A persistent "Take tour" control in the topbar so ANYONE — first-time or returning,
// on any browser — can (re)start the guided tour at will. This decouples the tour from
// the first-run gating (which keys off the wallet's on-chain state, so a wallet that
// already claimed/holds USDC would otherwise never see it again). Shown from `lg` up,
// where the desktop sidebar (the steps it spotlights) is visible.

import { useTour } from "./Tour";
import { TOUR } from "./tourSteps";
import { Compass } from "@/components/ui/icons";

export function TakeTourButton() {
  const { start, active } = useTour();
  return (
    <button
      onClick={() => start(TOUR)}
      disabled={active}
      title="Take a guided tour"
      aria-label="Take a guided tour"
      className="hidden shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-[11px] font-bold text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50 lg:inline-flex"
    >
      <Compass className="h-4 w-4" /> Take tour
    </button>
  );
}
