"use client";

import { Children, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";
import { ChevronRight } from "@/components/ui/icons";

/**
 * Client-side pagination primitives (FE-M7). The explorer runs on mock data, so
 * paging is a pure presentation concern — slice the list and show ~20 per page.
 * The seam is shaped so FE-M8 can feed one page at a time from the data layer
 * instead of slicing the full array here.
 */
export const DEFAULT_PAGE_SIZE = 20;

/** Windowed page-number list with `…` gaps, e.g. 1 … 4 5 [6] 7 8 … 20. */
function pageWindow(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
  const out: (number | "…")[] = [0];
  const lo = Math.max(1, page - 1);
  const hi = Math.min(pageCount - 2, page + 1);
  if (lo > 1) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pageCount - 2) out.push("…");
  out.push(pageCount - 1);
  return out;
}

export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  className,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row",
        className,
      )}
    >
      <span className="tnum text-xs text-muted">
        Showing <span className="font-medium text-foreground">{from}–{to}</span> of {total}
      </span>
      <div className="flex items-center gap-1">
        <PagerButton
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </PagerButton>
        {pageWindow(page, pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-xs text-muted-2">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(
                "tnum min-w-8 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                p === page
                  ? "bg-primary-soft text-primary"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {p + 1}
            </button>
          ),
        )}
        <PagerButton
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount - 1}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Page a flat array. Clamps the active page into range on every render (so a
 * shrinking list — e.g. after a filter change — never strands you on an empty
 * page); callers that change the underlying filter should also reset to page 0.
 */
export function usePaged<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, pageCount - 1);
  const pageItems = items.slice(clamped * pageSize, (clamped + 1) * pageSize);
  return { page: clamped, setPage, pageItems, pageCount, total, pageSize };
}

/**
 * Children-slicing paginator for grids/lists already rendered as elements (server
 * components can render every item, then pass them here to page client-side
 * without lifting data across the boundary). `className` styles the page wrapper
 * (e.g. the grid template).
 */
export function Paginated({
  children,
  pageSize = DEFAULT_PAGE_SIZE,
  className,
}: {
  children: ReactNode;
  pageSize?: number;
  className?: string;
}) {
  const items = Children.toArray(children);
  const { page, setPage, pageItems, pageCount, total } = usePaged(items, pageSize);
  return (
    <div className="space-y-4">
      <div className={className}>{pageItems}</div>
      <Pager
        page={page}
        pageCount={pageCount}
        total={total}
        pageSize={pageSize}
        onPage={setPage}
      />
    </div>
  );
}
