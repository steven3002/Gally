"use client";

import Link from "next/link";
import type { Asset } from "@/lib/types";
import {
  daysLeft,
  pct,
  pctOf,
  usdCompact,
} from "@/lib/format";
import { Avatar, ProgressBar } from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/bits";
import { CategoryIcon } from "@/components/ui/primitives";
import { Sparkline } from "@/components/ui/charts";
import { WatchButton } from "@/components/WatchButton";
import { ChevronRight } from "@/components/ui/icons";
import { Pager, usePaged } from "@/components/ui/Pager";

function accent(a: Asset): string {
  if (a.state === "OPERATIONAL") return "var(--positive)";
  if (a.state === "FUNDING") return "var(--primary)";
  if (["DEFAULTED", "COMPENSATING", "FAILED"].includes(a.state)) return "var(--danger)";
  return "var(--muted-2)";
}

export function AssetTable({ assets, pageSize }: { assets: Asset[]; pageSize?: number }) {
  const paginate = !!pageSize && pageSize > 0;
  const { page, setPage, pageItems, pageCount, total } = usePaged(
    assets,
    paginate ? pageSize! : Math.max(1, assets.length),
  );
  return (
    <div>
      {/* Scrollable table area — min-width prevents columns from squishing on narrow screens */}
      <div className="overflow-x-auto">
        <div className="min-w-[540px]">
          {/* header */}
          <div className="grid grid-cols-[1.6fr_0.8fr_1fr_0.9fr_0.6fr] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-2 md:grid-cols-[1.8fr_0.9fr_1.2fr_1fr_0.8fr_0.4fr]">
            <div>Asset</div>
            <div className="hidden md:block">Category</div>
            <div>Status / Raise</div>
            <div className="text-right">Goal</div>
            <div className="text-right">APY</div>
            <div className="hidden text-right md:block" />
          </div>

          <div className="divide-y divide-border">
            {pageItems.map((a) => {
              const progress = pctOf(a.raised, a.fundingGoal);
              const funding = a.state === "FUNDING";
              const operational = a.state === "OPERATIONAL";
              return (
                <Link
                  key={a.id}
                  href={`/assets/${a.id}`}
                  className="group grid grid-cols-[1.6fr_0.8fr_1fr_0.9fr_0.6fr] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 md:grid-cols-[1.8fr_0.9fr_1.2fr_1fr_0.8fr_0.4fr]"
                >
                  {/* asset */}
                  <div className="flex min-w-0 items-center gap-3">
                    <WatchButton assetId={a.id} className="hidden sm:block" />
                    <Avatar seed={a.id} label={a.ticker} size={34} rounded="rounded-lg" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{a.name}</div>
                      <div className="truncate text-xs text-muted">{a.entityName}</div>
                    </div>
                  </div>

                  {/* category */}
                  <div className="hidden items-center gap-1.5 text-xs text-muted md:flex">
                    <CategoryIcon category={a.category} className="h-3.5 w-3.5" />
                    <span className="truncate">{a.category}</span>
                  </div>

                  {/* status / raise */}
                  <div>
                    {funding ? (
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="tnum font-medium text-foreground">{pct(progress, 0)}</span>
                          <span className="text-muted">{daysLeft(a.fundingDeadlineMs)}d</span>
                        </div>
                        <ProgressBar value={progress} tone="primary" height="h-1.5" />
                      </div>
                    ) : (
                      <StatePill state={a.state} />
                    )}
                  </div>

                  {/* goal */}
                  <div className="text-right">
                    <div className="tnum text-sm font-medium text-foreground">
                      {usdCompact(a.fundingGoal)}
                    </div>
                    <div className="hidden text-[11px] text-muted md:block">
                      {usdCompact(a.raised)} raised
                    </div>
                  </div>

                  {/* apy + spark */}
                  <div className="flex items-center justify-end gap-2">
                    <Sparkline
                      data={a.spark}
                      color={accent(a)}
                      width={44}
                      height={20}
                      fill={false}
                      className="hidden lg:block"
                    />
                    <div className="text-right">
                      {operational ? (
                        <span className="tnum text-sm font-semibold text-positive">
                          {pct(a.accumulator?.apy ?? 0)}
                        </span>
                      ) : (
                        <span className="tnum text-sm text-muted-2">—</span>
                      )}
                    </div>
                  </div>

                  <div className="hidden justify-end text-muted-2 md:flex">
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      {paginate && (
        <Pager
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize!}
          onPage={setPage}
        />
      )}
    </div>
  );
}
