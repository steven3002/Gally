"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEMO_WALLET } from "@/lib/mock/data";

/**
 * Wallet-connect store (FE-M7.2, spec §6.1).
 *
 * The explorer's READ surfaces never touch this — only the transaction layer and
 * the topbar account control do. It is the source of "my receipts / my deeds /
 * my claimable" gating. Mocked now to the `DEMO_WALLET`; at FE-M8 the same hook
 * is reimplemented over a real wallet adapter (`@mysten/dapp-kit`) behind the
 * unchanged `{ connected, address, connect, disconnect }` shape.
 *
 * Backed by localStorage + a custom event and read through `useSyncExternalStore`
 * (mirrors `lib/watchlist.ts`), so server/first-client render agree and there is
 * no hydration drift. The connected boolean is a primitive → referentially stable.
 */

const KEY = "gally-wallet";
const EVENT = "gally-wallet-change";

// Default to connected so the demo experience (portfolio, "my" gating) works out
// of the box; an explicit "0" means the user disconnected.
function read(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

function write(connected: boolean) {
  try {
    localStorage.setItem(KEY, connected ? "1" : "0");
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const noopSubscribe = () => () => {};

/** The connected account, or `null` when disconnected. */
export function useWallet() {
  const connected = useSyncExternalStore(subscribe, read, () => true);
  // `hydrated` is false until the first client snapshot swaps in (server snapshot
  // `false`, client `true`), so connect/disconnect-specific UI can avoid a flash.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const connect = useCallback(() => write(true), []);
  const disconnect = useCallback(() => write(false), []);

  return {
    connected,
    address: connected ? DEMO_WALLET : null,
    hydrated,
    connect,
    disconnect,
  };
}
