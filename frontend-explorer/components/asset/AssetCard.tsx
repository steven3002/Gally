import Link from "next/link";
import type { Asset } from "@/lib/types";
import {
  daysLeft,
  pct,
  pctOf,
  usdCompact,
} from "@/lib/format";
import { Avatar, CategoryBadge, ProgressBar } from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/bits";
import { Sparkline } from "@/components/ui/charts";
import { WatchButton } from "@/components/WatchButton";

function accent(a: Asset): string {
  if (a.state === "OPERATIONAL") return "var(--positive)";
  if (a.state === "FUNDING") return "var(--primary)";
  if (a.state === "DEFAULTED" || a.state === "COMPENSATING" || a.state === "FAILED")
    return "var(--danger)";
  return "var(--muted-2)";
}

export function AssetCard({ asset }: { asset: Asset }) {
  const color = accent(asset);
  const progress = pctOf(asset.raised, asset.fundingGoal);
  const funding = asset.state === "FUNDING";
  const operational = asset.state === "OPERATIONAL";

  return (
    <Link
      href={`/assets/${asset.id}`}
      className="group block rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
    >
      <div className="flex items-start gap-3">
        <Avatar seed={asset.id} label={asset.ticker} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{asset.name}</h3>
          </div>
          <p className="truncate text-xs text-muted">{asset.entityName}</p>
        </div>
        <WatchButton assetId={asset.id} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <StatePill state={asset.state} />
        <CategoryBadge category={asset.category} />
      </div>

      {/* Headline metric + spark */}
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          {operational ? (
            <>
              <div className="text-[11px] font-medium text-muted">Effective APY</div>
              <div className="tnum text-2xl font-bold tracking-tight text-positive">
                {pct(asset.accumulator?.apy ?? 0)}
              </div>
            </>
          ) : funding ? (
            <>
              <div className="text-[11px] font-medium text-muted">Raised</div>
              <div className="tnum text-2xl font-bold tracking-tight text-foreground">
                {usdCompact(asset.raised)}
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] font-medium text-muted">Funding goal</div>
              <div className="tnum text-2xl font-bold tracking-tight text-foreground">
                {usdCompact(asset.fundingGoal)}
              </div>
            </>
          )}
        </div>
        <Sparkline data={asset.spark} color={color} width={104} height={40} />
      </div>

      {/* Footer row */}
      {funding ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
            <span className="tnum font-medium text-foreground">{pct(progress, 0)} funded</span>
            <span>{daysLeft(asset.fundingDeadlineMs)}d left</span>
          </div>
          <ProgressBar value={progress} tone="primary" height="h-1.5" />
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted">
          <span>
            Goal <span className="tnum font-medium text-foreground">{usdCompact(asset.fundingGoal)}</span>
          </span>
          <span className="tnum">
            {operational
              ? `${asset.holders.toLocaleString()} holders`
              : `${asset.contributors.toLocaleString()} contributors`}
          </span>
        </div>
      )}
    </Link>
  );
}

/** Compact list item — used in side rails / watchlist. */
export function AssetMini({ asset }: { asset: Asset }) {
  const color = accent(asset);
  const operational = asset.state === "OPERATIONAL";
  return (
    <Link
      href={`/assets/${asset.id}`}
      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2"
    >
      <Avatar seed={asset.id} label={asset.ticker} size={32} rounded="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{asset.name}</div>
        <div className="truncate text-[11px] text-muted">{asset.category}</div>
      </div>
      <div className="flex items-center gap-2">
        <Sparkline data={asset.spark} color={color} width={48} height={20} fill={false} />
        <div className="text-right">
          {operational ? (
            <div className="tnum text-[13px] font-semibold text-positive">
              {pct(asset.accumulator?.apy ?? 0)}
            </div>
          ) : (
            <div className="tnum text-[13px] font-semibold text-foreground">
              {pct(pctOf(asset.raised, asset.fundingGoal), 0)}
            </div>
          )}
          <div className="text-[10px] text-muted">{operational ? "APY" : "funded"}</div>
        </div>
      </div>
    </Link>
  );
}
