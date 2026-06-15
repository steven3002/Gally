"use client";

import { useSyncExternalStore } from "react";
import { Menu, Moon, Search, Sun } from "@/components/ui/icons";
import { OPEN_PALETTE_EVENT } from "@/components/search/CommandPalette";
import { NotificationBell } from "@/components/notifications/NotificationCenter";
import { ConnectButton } from "@/components/tx/ConnectButton";
import { protocolConfig } from "@/lib/mock/data";

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
        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong sm:max-w-md"
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
        <NotificationBell />

        {/* Network indicator — sits with the wallet control so the connected
            network is always visible, even before a wallet is connected. */}
        <span
          className="ml-1 flex items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-2"
          title={`Connected network: ${protocolConfig.network}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          <span className="hidden text-[11px] font-semibold capitalize text-muted-2 sm:inline">
            {protocolConfig.network}
          </span>
        </span>

        <ConnectButton />
      </div>
    </header>
  );
}

// The theme lives in the DOM (`<html class="dark">`, set pre-paint by the inline
// script in layout.tsx). Read it as external state so there's no setState-in-effect
// and no hydration mismatch: server/first-paint snapshot is `false` (Moon), then it
// swaps to the real value after hydration.
const THEME_EVENT = "gally:theme-change";

function subscribeTheme(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("gally-theme", next ? "dark" : "light");
    } catch {}
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button
      onClick={toggle}
      className="rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      aria-label="Toggle theme"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
