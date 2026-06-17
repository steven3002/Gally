"use client";

import { useSyncExternalStore } from "react";
import { optimisticKey, type TxIntent } from "./intents";

/**
 * Optimistic cross-page reconciliation store (FE-M7.2, spec §6.1 "optimistic state").
 *
 * The mock executor doesn't mutate the read fixtures, so once a transaction
 * succeeds the UI would otherwise still offer the same action and still show the
 * pre-action state. This store records a stable key per (verb, subject) — see
 * `optimisticKey` — so EVERY surface that renders that action reconciles to a
 * "submitted · reflected after indexing" state, consistently and across pages.
 *
 * Two consumers:
 *   • `ActionButton` collapses a submitted action to an applied chip (the action
 *     layer's optimistic reflection), and pushes its key here on success.
 *   • `lib/notifications` dismisses the matching seeded alert (e.g. "yield ready"
 *     once claimed), so the bell's unread count reconciles too.
 *
 * Backed by localStorage + a custom event and read through `useSyncExternalStore`
 * (mirrors `lib/wallet.ts` / `lib/notifications.ts`): SSR-safe (server snapshot is
 * empty), persists across navigation, syncs across tabs. At FE-M8 the live executor
 * reconciles against real object effects and this overlay is dropped.
 */

const KEY = "gally-optimistic";
const EVENT = "gally-optimistic-change";
const NOTIF_EVENT = "gally-notif-change"; // nudge the bell to re-derive its seeds

/** Read the applied-key set straight from storage (non-hook; used by the notif seeds). */
export function readApplied(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function write(keys: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...keys]));
    window.dispatchEvent(new CustomEvent(EVENT));
    window.dispatchEvent(new CustomEvent(NOTIF_EVENT));
  } catch {}
}

/** Record one or more applied keys (additive). */
export function markApplied(...keys: string[]) {
  const set = readApplied();
  let changed = false;
  for (const k of keys) {
    if (!set.has(k)) {
      set.add(k);
      changed = true;
    }
  }
  if (changed) write(set);
}

/** Convenience: record the effect of a successful intent. */
export function applyOptimistic(intent: TxIntent) {
  markApplied(optimisticKey(intent));
}

/** Clear all optimistic state (demo reset). */
export function resetOptimistic() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EVENT));
    window.dispatchEvent(new CustomEvent(NOTIF_EVENT));
  } catch {}
}

/* ----------------------------------------------------------- external store */

const EMPTY: ReadonlySet<string> = new Set();
let cache: ReadonlySet<string> = EMPTY;
let initialized = false;

function refresh() {
  cache = typeof window === "undefined" ? EMPTY : readApplied();
}

function getSnapshot(): ReadonlySet<string> {
  if (typeof window === "undefined") return EMPTY;
  if (!initialized) {
    initialized = true;
    refresh();
  }
  return cache;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

function subscribe(cb: () => void): () => void {
  const handler = () => {
    refresh();
    cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

const noopSubscribe = () => () => {};

export function useOptimistic() {
  const applied = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Gate on `hydrated` (server + first client render agree on "not applied") so a
  // persisted key never causes a hydration mismatch — the chip swaps in after.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return {
    hydrated,
    applied,
    isApplied: (key: string) => hydrated && applied.has(key),
  };
}
