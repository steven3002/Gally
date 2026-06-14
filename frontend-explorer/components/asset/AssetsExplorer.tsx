"use client";

import { useMemo, useState } from "react";
import type { Asset, AssetState, Category } from "@/lib/types";
import { assets } from "@/lib/mock/data";
import { cn, STATE_LABEL } from "@/lib/format";
import { AssetCard } from "./AssetCard";
import { AssetTable } from "./AssetTable";
import { Card } from "@/components/ui/primitives";
import { Search, Filter, Layers } from "@/components/ui/icons";

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

export function AssetsExplorer({ initialCategory }: { initialCategory?: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "All">(
    (CATEGORIES.includes(initialCategory as Category) ? initialCategory : "All") as
      | Category
      | "All",
  );
  const [state, setState] = useState<AssetState | "All">("All");
  const [sort, setSort] = useState<Sort>("raised");
  const [view, setView] = useState<"grid" | "table">("grid");

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
  }, [q, cat, state, sort]);

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
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                <Filter className="h-4 w-4 text-muted-2" />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="bg-transparent text-sm font-medium text-foreground outline-none"
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id} className="bg-surface text-foreground">
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex rounded-xl border border-border p-0.5">
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
          </div>

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
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a: Asset) => (
            <AssetCard key={a.id} asset={a} />
          ))}
        </div>
      ) : (
        <Card>
          <AssetTable assets={filtered} />
        </Card>
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
