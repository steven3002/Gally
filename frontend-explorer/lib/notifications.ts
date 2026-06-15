"use client";

import { useSyncExternalStore } from "react";
import type { Tone } from "@/lib/format";
import { NOW, HOUR, usd } from "@/lib/format";
import { DEMO_WALLET, portfolioReceipts } from "@/lib/mock/data";
import { holdingsOf } from "@/lib/mock/holders";

/**
 * Notification store (FE-M7.2, spec §4 "Notifications").
 *
 * One store backs both the topbar bell (the notification centre, with a REAL
 * unread count) and the toast host — so a transaction's outcome toast is also
 * archived in the bell. Two sources of items:
 *   (a) protocol ALERTS relevant to the connected account — deterministically
 *       seeded from the mock holdings/receipts (yield ready, grace deadline,
 *       finalize/refund). At FE-M8 these come from the live indexer feed.
 *   (b) the user's own TRANSACTION outcomes, pushed by `lib/tx/useTx`.
 *
 * Backed by localStorage + a custom event, read via `useSyncExternalStore`
 * (mirrors `lib/watchlist.ts`): seeds stay fresh in code while read/cleared state
 * persists. Deterministic — timestamps are offsets from the fixed `NOW`, never
 * `Date.now()` (guard_rails §2.6).
 */

export interface AppNotification {
  id: string;
  kind: "tx" | "alert";
  tone: Tone;
  title: string;
  body?: string;
  route?: string; // deep-link to the entity it concerns
  tsMs: number;
  read: boolean;
}

const TX_KEY = "gally-notif-tx";
const READ_KEY = "gally-notif-read";
const CLEARED_KEY = "gally-notif-cleared";
const EVENT = "gally-notif-change";

/* ----------------------------------------------------------- seeded alerts */

function seed(): AppNotification[] {
  const out: AppNotification[] = [];
  for (const h of holdingsOf(DEMO_WALLET)) {
    if (h.pendingYield > 0) {
      out.push({
        id: `seed-claim-${h.assetId}`,
        kind: "alert",
        tone: "positive",
        title: "Yield ready to claim",
        body: `${usd(h.pendingYield)} has accrued on your ${h.ticker} deeds via the lazy index.`,
        route: `/assets/${h.assetId}`,
        tsMs: NOW - 2 * HOUR,
        read: false,
      });
    }
    if (h.wrapped > 0 && h.state === "COMPENSATING") {
      out.push({
        id: `seed-grace-${h.assetId}`,
        kind: "alert",
        tone: "danger",
        title: "Unwrap before the grace deadline",
        body: `Your wrapped ${h.tokenSymbol ?? h.ticker} is not eligible for compensation until you unwrap it to deeds.`,
        route: `/assets/${h.assetId}`,
        tsMs: NOW - 35 * 60_000,
        read: false,
      });
    }
  }
  for (const r of portfolioReceipts) {
    const finalized = r.state !== "FUNDING" && r.state !== "FAILED" && r.state !== "CANCELLED";
    if (finalized) {
      out.push({
        id: `seed-deeds-${r.assetId}`,
        kind: "alert",
        tone: "info",
        title: "Raise finalized — claim your deeds",
        body: `${r.assetName} reached its goal. Convert your ${usd(r.amount)} receipt into GallyShare deeds.`,
        route: `/assets/${r.assetId}`,
        tsMs: NOW - 5 * HOUR,
        read: false,
      });
    } else if (r.state === "FAILED") {
      out.push({
        id: `seed-refund-${r.assetId}`,
        kind: "alert",
        tone: "warning",
        title: "Refund available",
        body: `${r.assetName} did not reach its goal. Refund your ${usd(r.amount)} contribution.`,
        route: `/assets/${r.assetId}`,
        tsMs: NOW - 6 * HOUR,
        read: false,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------ persistence */

function readArr(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function readTx(): AppNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TX_KEY);
    return raw ? (JSON.parse(raw) as AppNotification[]) : [];
  } catch {
    return [];
  }
}

function build(): AppNotification[] {
  const cleared = new Set(readArr(CLEARED_KEY));
  const readSet = new Set(readArr(READ_KEY));
  const byId = new Map<string, AppNotification>();
  for (const n of [...seed(), ...readTx()]) {
    if (cleared.has(n.id)) continue;
    byId.set(n.id, { ...n, read: readSet.has(n.id) });
  }
  return [...byId.values()].sort((a, b) => b.tsMs - a.tsMs);
}

const EMPTY: AppNotification[] = [];
let cache: AppNotification[] = EMPTY;
let initialized = false;

function refresh() {
  cache = typeof window === "undefined" ? EMPTY : build();
}

function getSnapshot(): AppNotification[] {
  if (typeof window === "undefined") return EMPTY;
  if (!initialized) {
    initialized = true;
    refresh();
  }
  return cache;
}

function getServerSnapshot(): AppNotification[] {
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

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    refresh();
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

const noopSubscribe = () => () => {};

/* --------------------------------------------------------------- mutations */

/** Append a transaction-outcome notification (called by `useTx`). */
export function pushNotification(n: Omit<AppNotification, "read">) {
  const next = [{ ...n, read: false }, ...readTx().filter((x) => x.id !== n.id)];
  persist(TX_KEY, next);
}

export function markRead(id: string) {
  const set = new Set(readArr(READ_KEY));
  set.add(id);
  persist(READ_KEY, [...set]);
}

export function markAllRead() {
  const ids = build().map((n) => n.id);
  persist(READ_KEY, ids);
}

export function clearAll() {
  const ids = build().map((n) => n.id);
  persist(CLEARED_KEY, ids);
}

/* ------------------------------------------------------------------ hook */

export function useNotifications() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const unread = hydrated ? items.filter((n) => !n.read).length : 0;
  return { items, unread, hydrated, markRead, markAllRead, clearAll };
}
