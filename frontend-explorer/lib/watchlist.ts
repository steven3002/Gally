"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "gally-watchlist";
const EVENT = "gally-watch-change";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

/* ---- external store plumbing (so the watchlist is read via useSyncExternalStore,
 *      not a setState-in-effect). getSnapshot must be referentially stable while
 *      the underlying localStorage string is unchanged, or React will loop. ---- */

const EMPTY: string[] = [];
let snapCache: string[] = EMPTY;
let snapRaw: string | null = null;

function getSnapshot(): string[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== snapRaw) {
    snapRaw = raw;
    try {
      snapCache = raw ? (JSON.parse(raw) as string[]) : EMPTY;
    } catch {
      snapCache = EMPTY;
    }
  }
  return snapCache;
}

function getServerSnapshot(): string[] {
  return EMPTY;
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

/**
 * Reactive watchlist backed by localStorage. `ids` is read through
 * `useSyncExternalStore`, so the server/first-client render sees an empty list
 * and React swaps in the stored value after hydration with no mismatch warning.
 * `hydrated` is false until that swap (a no-op store: server snapshot `false`,
 * client snapshot `true`) so the UI can avoid a flash of pre-hydration state.
 */
export function useWatchlist() {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const toggle = useCallback((id: string) => {
    const cur = read();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    write(next); // dispatches EVENT → subscribers re-read via getSnapshot
  }, []);

  return { ids, toggle, hydrated, has: (id: string) => ids.includes(id) };
}
