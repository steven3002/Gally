"use client";

import { useState } from "react";
import Link from "next/link";
import type { Holding } from "@/lib/types";
import { assetById } from "@/lib/mock/data";
import { graceOf, type Grace } from "@/lib/mock/health";
import { num, relTime, shortDate } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { Alert, ArrowRight, ChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/format";

interface AtRisk {
  assetId: string;
  assetName: string;
  wrapped: number;
  tokenSymbol?: string;
  grace: Grace;
}

/**
 * Holder-protection alert (FE-M5 — the §13 spec-mandated obligation). For any
 * wrapped position whose asset is in an active compensation grace window, render
 * an unmissable "unwrap before {deadline}" banner with a live countdown and a
 * link to the asset. Missing the deadline forfeits the slashed/seized restitution.
 */
export function UnwrapAlert({ holdings }: { holdings: Holding[] }) {
  const [expanded, setExpanded] = useState(false);

  const atRisk: AtRisk[] = [];
  for (const h of holdings) {
    if (h.wrapped <= 0) continue;
    const a = assetById[h.assetId];
    const grace = a ? graceOf(a) : undefined;
    if (!grace || !grace.active) continue;
    atRisk.push({
      assetId: h.assetId,
      assetName: h.assetName,
      wrapped: h.wrapped,
      tokenSymbol: h.tokenSymbol,
      grace,
    });
  }
  if (atRisk.length === 0) return null;

  return (
    <Card className="border-danger/40">
      <div className="bg-danger-soft p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
            <Alert className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-foreground">
              Unwrap now — deadline approaching for compensation
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              Wrapped <code>Coin&lt;T&gt;</code> is <strong>excluded</strong> from slashed/seized
              restitution in {atRisk.length === 1 ? "this asset" : `${atRisk.length} assets`}. Unwrap
              to GallyShare deeds before the deadline or you permanently forfeit it.
            </p>
            {/* Learn more toggle */}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-danger hover:underline"
            >
              {expanded ? "Hide details" : "Learn more"}
              <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", expanded && "rotate-180")} />
            </button>
            {expanded && (
              <p className="mt-2 text-xs text-muted">
                The protocol&apos;s compensation mechanism (§13) distributes slashed validator stake
                and seized collateral exclusively to <em>GallyShare deed</em> holders at the snapshot
                block. Coins held in the wrapped <code>Coin&lt;T&gt;</code> form are not deed holders
                at that moment — they must be unwrapped first via the asset page below.
              </p>
            )}
            <div className="mt-3 space-y-2">
              {atRisk.map((r) => (
                <Link
                  key={r.assetId}
                  href={`/assets/${r.assetId}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-surface px-3.5 py-2.5 transition-colors hover:border-danger/60"
                >
                  {/* Name + deadline stack on the left; amount + arrow on the right.
                      Stacking the deadline under the name (instead of one long line)
                      keeps the row scannable and from spilling on narrow screens. */}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{r.assetName}</span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-danger">
                      Unwrap before {shortDate(r.grace.unlockMs)} · {relTime(r.grace.unlockMs)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tnum rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">
                      {num(r.wrapped)} {r.tokenSymbol ?? "wrapped"}
                    </span>
                    <ArrowRight className="h-4 w-4 text-danger" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
