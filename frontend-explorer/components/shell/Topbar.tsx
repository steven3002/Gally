"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Menu, Moon, Search, Sun, Wallet } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/primitives";
import { OPEN_PALETTE_EVENT } from "@/components/search/CommandPalette";
import { DEMO_WALLET } from "@/lib/mock/data";
import { shortAddr } from "@/lib/format";

function openPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md lg:px-6">
      <button
        onClick={onOpenMenu}
        className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Search — opens the global ⌘K command palette */}
      <button
        onClick={openPalette}
        className="flex w-full max-w-md items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong"
        aria-label="Search the protocol"
      >
        <Search className="h-4 w-4 shrink-0 text-muted-2" />
        <span className="w-full truncate text-sm text-muted-2">
          Search assets, accounts, validators, tx…
        </span>
        <kbd className="hidden rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-2 sm:block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <button className="relative rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger" />
        </button>

        {/* Demo wallet chip → its account page */}
        <Link
          href={`/address/${DEMO_WALLET}`}
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
