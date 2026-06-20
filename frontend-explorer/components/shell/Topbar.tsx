"use client";

import { useSyncExternalStore } from "react";
import { Menu, Moon, Search, Sun } from "@/components/ui/icons";
import { OPEN_PALETTE_EVENT } from "@/components/search/CommandPalette";
import { NotificationBell } from "@/components/notifications/NotificationCenter";
import { ConnectButton } from "@/components/tx/ConnectButton";
import { LiveConnectButton } from "@/components/tx/LiveConnectButton";
import { ClaimTokensButton } from "@/components/onboarding/ClaimTokensButton";
import { TakeTourButton } from "@/components/onboarding/TakeTourButton";
import { UsdcBalancePill } from "@/components/tx/UsdcBalance";
import { isLive } from "@/lib/data";
import { IS_DEVNET, SUI_NETWORK } from "@/lib/tx/config";

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

      {/* Search — opens the global ⌘K command palette. Icon-only on mobile so the wallet
          controls (balance + claim) fit a 375px topbar; full search bar from sm up. */}
      <button
        onClick={openPalette}
        className="flex flex-none items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:border-border-strong sm:min-w-0 sm:flex-1 sm:max-w-md sm:px-3"
        aria-label="Search the protocol"
      >
        <Search className="h-4 w-4 shrink-0 text-muted-2" />
        <span className="hidden w-full truncate text-sm text-muted-2 sm:block">
          Search assets, accounts, validators, tx…
        </span>
        <kbd className="hidden rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-2 sm:block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Persistent "Take tour" — anyone can (re)start the guided tour (desktop). */}
        {isLive && <TakeTourButton />}
        <ThemeToggle />
        {/* Notifications — non-critical, hidden on mobile to free room for wallet controls. */}
        <span className="hidden sm:inline-flex">
          <NotificationBell />
        </span>

        {/* Live wallet's USDC balance — so a user can always see what they have to invest. */}
        {isLive && <UsdcBalancePill />}

        {/* Devnet: a persistent "Get test USDC" tap so a user can always fund up. */}
        {isLive && IS_DEVNET && <ClaimTokensButton />}

        {/* Live network indicator — colour-coded + always visible (the actual chain
            the app is pointed at, not a fixed label). */}
        <NetworkChip />

        {/* Live mode → dapp-kit ConnectModal (Slush + wallet-standard auto-detect,
            with the Slush web option when nothing is installed). Mock → demo wallet. */}
        {isLive ? <LiveConnectButton /> : <ConnectButton />}
      </div>
    </header>
  );
}

// Colour-coded chip showing the ACTUAL network the app targets (from NEXT_PUBLIC_SUI_NETWORK).
const NET_STYLE: Record<string, { dot: string; chip: string }> = {
  devnet: { dot: "bg-warning", chip: "border-warning/40 bg-warning-soft text-warning" },
  testnet: { dot: "bg-primary", chip: "border-primary/40 bg-primary-soft text-primary" },
  mainnet: { dot: "bg-positive", chip: "border-positive/40 bg-positive-soft text-positive" },
  localnet: { dot: "bg-muted-2", chip: "border-border bg-surface text-muted-2" },
};

function NetworkChip() {
  const s = NET_STYLE[SUI_NETWORK] ?? NET_STYLE.localnet;
  return (
    <span
      data-tour="network"
      title={`Connected to Sui ${SUI_NETWORK}`}
      className={`ml-1 flex items-center gap-1.5 rounded-xl border px-2.5 py-2 ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} animate-[gally-pulse_2s_ease-in-out_infinite]`} />
      <span className="text-[11px] font-bold uppercase tracking-wide">{SUI_NETWORK}</span>
    </span>
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
