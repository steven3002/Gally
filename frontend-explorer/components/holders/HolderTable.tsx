"use client";

import Link from "next/link";
import type { RankedHolder } from "@/lib/mock/holders";
import { accountLabel } from "@/lib/mock/accounts";
import { cn, num, pct, shortAddr } from "@/lib/format";
import { Avatar } from "@/components/ui/primitives";
import { Coins, Lock } from "@/components/ui/icons";
import { Pager, usePaged } from "@/components/ui/Pager";

// Shared column template — the header and every body row use the same grid so
// the Deeds / Wrapped / Share columns line up vertically down the whole table.
const COLS = "sm:grid sm:grid-cols-[minmax(0,2.4fr)_1fr_1fr_1.3fr] sm:items-center sm:gap-4";

/**
 * Ranked holder ledger for one asset/token (FE-M3). Each row is a link to the
 * holder's `/address/:addr` page — this is what powers "who holds a thing" and
 * "click a holder → see what *they* hold". Deeds (yield-bearing) and wrapped
 * Coin<T> (no yield) are shown separately, with each holder's % of supply.
 */
export function HolderTable({
  holders,
  tokenSymbol,
  demoAddress,
  pageSize,
}: {
  holders: RankedHolder[];
  tokenSymbol?: string;
  demoAddress?: string;
  pageSize?: number;
}) {
  const paginate = !!pageSize && pageSize > 0;
  const { page, setPage, pageItems, pageCount, total, pageSize: ps } = usePaged(
    holders,
    paginate ? pageSize! : Math.max(1, holders.length),
  );
  // Bars are scaled to the largest holding in the list so the long tail stays legible.
  const maxPct = holders[0]?.pctOfSupply || 100;
  const offset = page * ps;

  return (
    <div>
      {/* Column header (sm+ only; rows stack with inline labels on mobile) */}
      <div
        className={cn(
          "hidden border-b border-border px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-2",
          COLS,
        )}
      >
        <span>Holder</span>
        <span className="text-right">Deeds</span>
        <span className="text-right">Wrapped</span>
        <span className="text-right">Share of supply</span>
      </div>

      <div className="divide-y divide-border">
        {pageItems.map((h, i) => {
          const label = accountLabel(h.address);
          const isYou = demoAddress && h.address === demoAddress;
          return (
            <div
              key={h.address}
              className={cn(
                "flex flex-col gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2",
                COLS,
              )}
            >
              <Link
                href={`/address/${h.address}`}
                className="flex min-w-0 items-center gap-3 hover:text-primary"
              >
                <span className="tnum w-5 shrink-0 text-xs font-semibold text-muted-2">
                  {offset + i + 1}
                </span>
                <Avatar seed={h.address} label={label} size={34} rounded="rounded-lg" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {label ?? shortAddr(h.address, 10, 6)}
                    </span>
                    {isYou && (
                      <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                        You
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-2">
                    {shortAddr(h.address, 12, 8)}
                  </div>
                </div>
              </Link>

              {/* On mobile these three share a 3-col grid; on sm+ `contents`
                  dissolves the wrapper so they align to the table columns. */}
              <div className="grid grid-cols-3 items-start gap-x-6 sm:contents">
                <Cell
                  label="Deeds"
                  value={num(h.shareCount)}
                  icon={<Coins className="h-3 w-3 text-positive" />}
                />
                <Cell
                  label="Wrapped"
                  value={h.wrapped > 0 ? num(h.wrapped) : "—"}
                  sub={h.wrapped > 0 ? tokenSymbol : undefined}
                  icon={h.wrapped > 0 ? <Lock className="h-3 w-3 text-muted-2" /> : undefined}
                />
                <div className="text-left sm:text-right">
                  <div className="text-[11px] text-muted-2 sm:hidden">Share</div>
                  <div className="tnum text-sm font-semibold text-foreground">
                    {pct(h.pctOfSupply, 2)}
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-3 sm:ml-auto sm:w-16">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(3, (h.pctOfSupply / maxPct) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {paginate && (
        <Pager
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={ps}
          onPage={setPage}
        />
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="text-left sm:text-right">
      {/* label repeats per-row on mobile; on sm+ the table header carries it */}
      <div className="text-[11px] text-muted-2 sm:hidden">{label}</div>
      <div className="tnum flex items-center gap-1 text-sm font-semibold text-foreground sm:justify-end">
        {icon}
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-2">{sub}</div>}
    </div>
  );
}
