"use client";

import Link from "next/link";
import type { EventFeed, ProtocolEvent } from "@/lib/types";
import { cn, relTime, shortDigest, usd } from "@/lib/format";
import type { Tone } from "@/lib/format";
import {
  Activity,
  Coins,
  Layers,
  Scale,
  Settings,
  Shield,
  TrendUp,
} from "@/components/ui/icons";
import { Empty } from "@/components/ui/primitives";
import { Pager, usePaged } from "@/components/ui/Pager";

const FEED_META: Record<EventFeed, { tone: Tone; icon: (p: { className?: string }) => React.ReactNode }> = {
  lifecycle: { tone: "primary", icon: Layers },
  position: { tone: "positive", icon: Coins },
  revenue: { tone: "info", icon: TrendUp },
  validator: { tone: "info", icon: Shield },
  dispute: { tone: "danger", icon: Scale },
  governance: { tone: "neutral", icon: Settings },
};

const TONE_BG: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-muted",
};

export function EventList({
  events,
  showAsset = true,
  limit,
  pageSize,
  emptyHint,
}: {
  events: ProtocolEvent[];
  showAsset?: boolean;
  /** Hard cap — show at most N rows, no pager (teaser lists). */
  limit?: number;
  /** Paginate at N rows per page (long feeds). Ignored when `limit` is set. */
  pageSize?: number;
  emptyHint?: string;
}) {
  const capped = limit ? events.slice(0, limit) : events;
  const paginate = !limit && !!pageSize && pageSize > 0;
  const { page, setPage, pageItems, pageCount, total } = usePaged(
    capped,
    paginate ? pageSize! : Math.max(1, capped.length),
  );

  if (capped.length === 0) {
    return <Empty icon={<Activity className="h-8 w-8" />} title="No activity yet" hint={emptyHint} />;
  }

  return (
    <>
      <ul className="divide-y divide-border">
      {pageItems.map((e) => {
        const meta = FEED_META[e.feed];
        const Icon = meta.icon;
        return (
          <li
            key={e.id}
            className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60"
          >
            <span
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                TONE_BG[meta.tone],
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium text-foreground">{e.summary}</p>
                {typeof e.amount === "number" && e.amount > 0 && (
                  <span className="tnum shrink-0 text-sm font-semibold text-foreground">
                    {usd(e.amount)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                {e.meta && <span className="truncate">{e.meta}</span>}
                {showAsset && e.assetId && e.assetName && (
                  <>
                    <span className="text-muted-2">·</span>
                    <Link
                      href={`/assets/${e.assetId}`}
                      className="text-primary hover:underline"
                    >
                      {e.assetName}
                    </Link>
                  </>
                )}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xs text-muted">{relTime(e.tsMs)}</div>
              <Link
                href={`/tx/${e.txDigest}`}
                className="mt-0.5 block font-mono text-[10px] text-muted-2 transition-colors hover:text-primary hover:underline"
              >
                {shortDigest(e.txDigest)}
              </Link>
            </div>
          </li>
        );
      })}
      </ul>
      {paginate && (
        <Pager
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize!}
          onPage={setPage}
        />
      )}
    </>
  );
}
