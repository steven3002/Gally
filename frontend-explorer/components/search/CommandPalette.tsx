"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchAll, type SearchResult } from "@/lib/mock/registry";
import type { ObjectKind } from "@/lib/types";
import { cn } from "@/lib/format";
import { Activity, Coins, Layers, Scale, Search, Settings, Shield, Wallet } from "@/components/ui/icons";

/** Fire this to open the palette from anywhere (the topbar search button does). */
export const OPEN_PALETTE_EVENT = "gally:open-command-palette";

const KIND_ICON: Record<ObjectKind, (p: { className?: string }) => React.ReactNode> = {
  asset: Layers,
  token: Coins,
  validator: Shield,
  account: Wallet,
  dispute: Scale,
  tx: Activity,
  config: Settings,
};

const KIND_LABEL: Record<ObjectKind, string> = {
  asset: "Assets",
  token: "Tokens",
  validator: "Validators",
  account: "Accounts",
  dispute: "Disputes",
  tx: "Transactions",
  config: "Protocol",
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchAll(q, 24), [q]);

  // Open on ⌘K / Ctrl-K, or the topbar's custom event. Close on Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => setActive(0), [q]);

  function go(r: SearchResult) {
    setOpen(false);
    router.push(r.route);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) go(results[active]);
      else if (q.trim()) {
        setOpen(false);
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    }
  }

  if (!open) return null;

  // group results by kind, preserving rank order
  const groups: { kind: ObjectKind; items: SearchResult[] }[] = [];
  let flatIndex = 0;
  const indexed = results.map((r) => ({ r, i: flatIndex++ }));
  for (const { r } of indexed) {
    let g = groups.find((x) => x.kind === r.kind);
    if (!g) {
      g = { kind: r.kind, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-2" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search assets, accounts, validators, disputes, tx, or paste an id…"
            className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-2"
          />
          <kbd className="hidden rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-2 sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {q.trim() === "" ? (
            <p className="px-3 py-8 text-center text-xs text-muted">
              Type to search the protocol — or paste an object id, address, or transaction digest.
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted">No matches for “{q}”.</p>
          ) : (
            groups.map((g) => {
              const Icon = KIND_ICON[g.kind];
              return (
                <div key={g.kind} className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
                    {KIND_LABEL[g.kind]}
                  </div>
                  {g.items.map((r) => {
                    const i = indexed.find((x) => x.r === r)!.i;
                    return (
                      <button
                        key={r.id}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(r)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left",
                          i === active ? "bg-surface-2" : "hover:bg-surface-2/60",
                        )}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
                          <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-2">
          <span>↑↓ navigate · ↵ open · Esc close</span>
          <span>Gally Explorer</span>
        </div>
      </div>
    </div>
  );
}
