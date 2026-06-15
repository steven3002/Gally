import Link from "next/link";
import type { Holding } from "@/lib/types";
import { assetById } from "@/lib/mock/data";
import { graceOf, type Grace } from "@/lib/mock/health";
import { num, relTime, shortDate } from "@/lib/format";
import { Card } from "@/components/ui/primitives";
import { Alert, ArrowRight } from "@/components/ui/icons";

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
      <div className="bg-danger-soft p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
            <Alert className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">
              Action needed — unwrap to keep your compensation
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              You hold wrapped tokens in {atRisk.length === 1 ? "an asset" : `${atRisk.length} assets`} with an
              open compensation grace window. Wrapped <code>Coin&lt;T&gt;</code> is <strong>not eligible</strong>{" "}
              for the slashed/seized restitution — unwrap to GallyShare deeds before the deadline or you
              permanently miss it (§13).
            </p>
            <div className="mt-3 space-y-2">
              {atRisk.map((r) => (
                <Link
                  key={r.assetId}
                  href={`/assets/${r.assetId}`}
                  className="flex flex-col gap-1 rounded-xl border border-danger/30 bg-surface px-3.5 py-2.5 transition-colors hover:border-danger/60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {r.assetName}
                    <span className="tnum rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">
                      {num(r.wrapped)} {r.tokenSymbol ?? "wrapped"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger">
                    Unwrap before {shortDate(r.grace.unlockMs)} ({relTime(r.grace.unlockMs)})
                    <ArrowRight className="h-3.5 w-3.5" />
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
