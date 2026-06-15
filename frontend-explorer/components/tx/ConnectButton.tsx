"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { Avatar } from "@/components/ui/primitives";
import { Wallet } from "@/components/ui/icons";

/**
 * Topbar wallet control (FE-M7.2). Connected → account chip with a small menu
 * (view account / disconnect); disconnected → a Connect button. Mocked to the
 * `DEMO_WALLET` now; swaps to a real wallet adapter at FE-M8 behind `useWallet`.
 */
export function ConnectButton() {
  const { connected, address, hydrated, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Pre-hydration: render the connected chip (the server/default state) so there
  // is no layout flash; the real state swaps in after hydration.
  if (!hydrated || (connected && address)) {
    const addr = address ?? "";
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-surface py-1.5 pl-2 pr-3 transition-colors hover:border-border-strong"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar seed={addr} size={28} rounded="rounded-lg" />
          <span className="hidden leading-none sm:block">
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">{shortAddr(addr)}</span>
              <span className="rounded bg-warning-soft px-1 py-0.5 text-[9px] font-bold uppercase text-warning">
                Demo
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
              <Wallet className="h-3 w-3" /> connected
            </span>
          </span>
        </button>

        {open && (
          <>
            <button className="fixed inset-0 z-40 cursor-default" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
            <div role="menu" className="motion-safe:animate-rise absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-lg)]">
              <Link
                href={`/address/${addr}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-2"
              >
                View account
              </Link>
              <button
                role="menuitem"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-danger transition-colors hover:bg-danger-soft"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-strong"
    >
      <Wallet className="h-4 w-4" /> Connect wallet
    </button>
  );
}
