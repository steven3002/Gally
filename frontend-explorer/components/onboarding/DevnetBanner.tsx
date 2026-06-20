"use client";

// DEV-M1 — a slim banner making the active network unmistakable. Shown only when the app
// is pointed at the public Sui Devnet (NEXT_PUBLIC_SUI_NETWORK=devnet). Dismissible.

import { useSyncExternalStore } from "react";
import { IS_DEVNET, SUI_NETWORK } from "@/lib/tx/config";
import { Close } from "@/components/ui/icons";

const KEY = "gally-devnet-banner-dismissed";
const EVENT = "gally-devnet-banner";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function DevnetBanner() {
  const isDismissed = useSyncExternalStore(subscribe, dismissed, () => false);
  if (!IS_DEVNET || isDismissed) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center text-[12px] font-medium text-warning">
      <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
      <span>
        Connected to <strong className="font-bold uppercase tracking-wide">Sui {SUI_NETWORK}</strong> — a public test
        network. Tokens have no real value.
      </span>
      <button
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {}
          window.dispatchEvent(new Event(EVENT));
        }}
        className="ml-1 rounded p-0.5 text-warning/70 transition-colors hover:text-warning"
      >
        <Close className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
