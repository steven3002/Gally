"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset, AssetState, Category } from "@/lib/types";
import { cn, STATE_LABEL } from "@/lib/format";
import { AssetCard } from "./AssetCard";
import { AssetTable } from "./AssetTable";
import { Card } from "@/components/ui/primitives";
import { Pager, usePaged } from "@/components/ui/Pager";
import { Search, Filter, Layers, ChevronDown, Check } from "@/components/ui/icons";

const CATEGORIES: (Category | "All")[] = [
  "All",
  "Housing",
  "Energy",
  "Trade Finance",
  "Agriculture",
  "Machinery",
  "Infrastructure",
];

const STATES: (AssetState | "All")[] = [
  "All",
  "FUNDING",
  "OPERATIONAL",
  "EXECUTING",
  "PENDING_VOUCH",
  "COMPENSATING",
  "CLOSED",
  "FAILED",
];

type Sort = "raised" | "apy" | "newest" | "progress";
const SORTS: { id: Sort; label: string }[] = [
  { id: "raised", label: "Capital raised" },
  { id: "apy", label: "Highest APY" },
  { id: "newest", label: "Newest" },
  { id: "progress", label: "Funding progress" },
];

export function AssetsExplorer({ initialCategory, assets }: { initialCategory?: string; assets: Asset[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "All">(
    (CATEGORIES.includes(initialCategory as Category) ? initialCategory : "All") as
      | Category
      | "All",
  );
  const [state, setState] = useState<AssetState | "All">("All");
  const [sort, setSort] = useState<Sort>("raised");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = assets.filter((a) => {
      if (cat !== "All" && a.category !== cat) return false;
      if (state !== "All" && a.state !== state) return false;
      if (
        term &&
        !(
          a.name.toLowerCase().includes(term) ||
          a.ticker.toLowerCase().includes(term) ||
          a.entityName.toLowerCase().includes(term) ||
          a.location.toLowerCase().includes(term)
        )
      )
        return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "apy":
          return (b.accumulator?.apy ?? 0) - (a.accumulator?.apy ?? 0);
        case "newest":
          return b.createdAtMs - a.createdAtMs;
        case "progress":
          return b.raised / b.fundingGoal - a.raised / a.fundingGoal;
        default:
          return b.raised - a.raised;
      }
    });
    return list;
  }, [assets, q, cat, state, sort]);

  // Page the filtered list (cards are large, so ~12/page = 4 grid rows). Reset to
  // the first page whenever the filter/sort signature changes (adjust-during-render).
  const { page, setPage, pageItems, pageCount, total } = usePaged(filtered, 12);
  const sig = `${q}|${cat}|${state}|${sort}`;
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    setPrevSig(sig);
    setPage(0);
  }

  const activeFilterCount = (cat !== "All" ? 1 : 0) + (state !== "All" ? 1 : 0);

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
              <Search className="h-4 w-4 text-muted-2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, entity, ticker or location…"
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-2"
              />
            </div>
            {/* Sort + view toggle — sort flexes to fill the row on mobile so the
                menu (and its panel) never clip; both sit inline on desktop. */}
            <div className="flex items-center gap-2">
              <SortMenu value={sort} onChange={setSort} />
              <div className="flex shrink-0 rounded-xl border border-border p-0.5">
                {(["grid", "table"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize transition-colors",
                      view === v ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            {/* Mobile/tablet filter toggle — full width on mobile so it can't run
                off-screen; auto width once it shares the desktop row. */}
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className={cn(
                "md:hidden flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors sm:w-auto",
                filtersOpen || activeFilterCount > 0
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted hover:text-foreground",
              )}
            >
              Filters
              {activeFilterCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-on-primary">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  filtersOpen && "rotate-180",
                )}
              />
            </button>
          </div>

          {/* Filter chips — always visible on md+, collapsed behind toggle on mobile */}
          <div className={cn("flex flex-col gap-3", filtersOpen ? "flex" : "hidden md:flex")}>
            {/* Category chips */}
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
                  {c}
                </Chip>
              ))}
            </div>

            {/* State chips */}
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {STATES.map((s) => (
                <Chip key={s} active={state === s} onClick={() => setState(s)} subtle>
                  {s === "All" ? "All statuses" : STATE_LABEL[s]}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-muted">
          <span className="font-semibold text-foreground">{filtered.length}</span> asset
          {filtered.length === 1 ? "" : "s"}
          {cat !== "All" && <> in {cat}</>}
        </p>
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Layers className="h-8 w-8 text-muted-2" />
          <p className="text-sm font-medium text-foreground">No assets match your filters</p>
          <p className="text-xs text-muted">Try clearing the search or selecting another sector.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          {view === "grid" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((a: Asset) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          ) : (
            <Card>
              <AssetTable assets={pageItems} />
            </Card>
          )}
          <Pager
            page={page}
            pageCount={pageCount}
            total={total}
            pageSize={12}
            onPage={setPage}
            className="rounded-[var(--radius-card)] border border-border bg-surface"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Themed sort selector. Replaces the native <select> (whose option list is
 * OS-styled, unthemeable, and on mobile renders a full-screen picker that ran off
 * the design). This is a self-contained popover: outside-click + Escape close it,
 * and it's right-anchored + width-capped so it can't spill off a narrow viewport.
 */
function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = SORTS.find((s) => s.id === value) ?? SORTS[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-1 sm:flex-none">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-strong"
      >
        <Filter className="h-4 w-4 shrink-0 text-muted-2" />
        <span className="hidden text-xs font-normal text-muted-2 sm:inline">Sort</span>
        <span className="flex-1 truncate text-left">{current.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-2 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="motion-safe:animate-rise absolute inset-x-0 z-50 mt-2 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-lg)] sm:left-auto sm:right-0 sm:w-56"
        >
          {SORTS.map((s) => (
            <button
              key={s.id}
              role="option"
              aria-selected={s.id === value}
              onClick={() => {
                onChange(s.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                s.id === value
                  ? "bg-primary-soft font-semibold text-primary"
                  : "text-foreground hover:bg-surface-2",
              )}
            >
              {s.label}
              {s.id === value && <Check className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  subtle,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  subtle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? subtle
            ? "border-foreground/15 bg-foreground/5 text-foreground"
            : "border-primary bg-primary text-on-primary"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
