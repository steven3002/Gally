"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Menu,
  Moon,
  Search,
  Sun,
  Wallet,
  Layers,
  Shield,
} from "@/components/ui/icons";
import { Avatar } from "@/components/ui/primitives";
import { assets, validators, DEMO_WALLET } from "@/lib/mock/data";
import { cn, shortAddr, STATE_LABEL } from "@/lib/format";

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return { assets: [], validators: [] };
    return {
      assets: assets
        .filter(
          (a) =>
            a.name.toLowerCase().includes(term) ||
            a.ticker.toLowerCase().includes(term) ||
            a.entityName.toLowerCase().includes(term) ||
            a.category.toLowerCase().includes(term),
        )
        .slice(0, 5),
      validators: validators
        .filter((v) => v.name.toLowerCase().includes(term))
        .slice(0, 3),
    };
  }, [q]);

  function go(href: string) {
    setOpen(false);
    setQ("");
    router.push(href);
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md lg:px-6">
      <button
        onClick={onOpenMenu}
        className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Search */}
      <div ref={boxRef} className="relative w-full max-w-md">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-[var(--ring)]">
          <Search className="h-4 w-4 shrink-0 text-muted-2" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search assets, entities, validators…"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-2"
          />
          <kbd className="hidden rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-2 sm:block">
            ⌘K
          </kbd>
        </div>

        {open && (results.assets.length > 0 || results.validators.length > 0) && (
          <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-lg)]">
            {results.assets.length > 0 && (
              <div className="p-2">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
                  Assets
                </div>
                {results.assets.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => go(`/assets/${a.id}`)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
                  >
                    <Avatar seed={a.id} label={a.ticker} size={28} rounded="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{a.name}</div>
                      <div className="truncate text-xs text-muted">
                        {a.category} · {STATE_LABEL[a.state]}
                      </div>
                    </div>
                    <Layers className="h-4 w-4 text-muted-2" />
                  </button>
                ))}
              </div>
            )}
            {results.validators.length > 0 && (
              <div className="border-t border-border p-2">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
                  Validators
                </div>
                {results.validators.map((v) => (
                  <button
                    key={v.poolId}
                    onClick={() => go(`/validators/${v.poolId}`)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
                  >
                    <Avatar seed={v.poolId} label={v.name} size={28} rounded="rounded-full" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{v.name}</div>
                      <div className="truncate text-xs text-muted">{v.status}</div>
                    </div>
                    <Shield className="h-4 w-4 text-muted-2" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <button className="relative rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground">
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
        </button>

        {/* Demo wallet chip */}
        <Link
          href="/portfolio"
          className="ml-1 flex items-center gap-2.5 rounded-xl border border-border bg-surface py-1.5 pl-2 pr-3 transition-colors hover:border-border-strong"
        >
          <Avatar seed={DEMO_WALLET} size={28} rounded="rounded-lg" />
          <div className="hidden leading-none sm:block">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">{shortAddr(DEMO_WALLET)}</span>
              <span className="rounded bg-warning-soft px-1 py-0.5 text-[9px] font-bold uppercase text-warning">
                Demo
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
              <Wallet className="h-3 w-3" /> connected
            </div>
          </div>
        </Link>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("gally-theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      className="rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      aria-label="Toggle theme"
    >
      {mounted && dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
