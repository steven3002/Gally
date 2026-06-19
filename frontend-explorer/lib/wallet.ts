"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { DEMO_WALLET } from "@/lib/mock/data";
import { isLive } from "@/lib/data";

/**
 * Wallet-connect store (FE-M7.2 mock → FE-M8b live), behind one shape:
 * `{ connected, address, hydrated, connect, disconnect }`. The read surfaces never
 * touch this — only the transaction layer + the topbar account control do.
 *
 * The mock impl (default) is the `DEMO_WALLET` over localStorage. The live impl
 * (`NEXT_PUBLIC_DATA_SOURCE=live`) is the connected `@mysten/dapp-kit` account; the
 * actual connect UX is dapp-kit's `<ConnectButton>` modal in the topbar (Slush +
 * wallet-standard auto-detect), so `connect()` is a no-op entry here. The mock vs.
 * live choice is a build-time constant, so `useWallet` is a stable alias of one hook.
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

/** Mock wallet: the demo account, toggled via localStorage. */
function useWalletMock() {
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

/** Live wallet: the connected dapp-kit account. Connect via the topbar ConnectButton. */
function useWalletLive() {
  const account = useCurrentAccount();
  const { mutate: dappDisconnect } = useDisconnectWallet();
  const connect = useCallback(() => {
    /* the dapp-kit <ConnectButton> modal is the connect entry point */
  }, []);
  const disconnect = useCallback(() => dappDisconnect(), [dappDisconnect]);
  return {
    connected: !!account,
    address: account?.address ?? null,
    hydrated: true,
    connect,
    disconnect,
  };
}

/** Build-time alias of the mock or live wallet hook (identical surface). */
export const useWallet = isLive ? useWalletLive : useWalletMock;
