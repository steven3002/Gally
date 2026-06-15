// Governance fixture (FE-M1). ProtocolConfig parameter history is event-only on
// chain (§18.3 P3) — there is no historical object read — so the indexer/mock
// must archive it. This module is the single source for the param-change log and
// the genesis/pause markers; `activity.ts` emits matching governance events from
// it so the feed and the /governance page agree.

import type { GovParamChange } from "../types";
import { protocolConfig } from "./data";
import { NOW, DAY } from "../format";
import { seeded } from "./series";

export { protocolConfig };

/** Deterministic 0x…(44 hex) tx digest from a stable label. */
export function govDigest(label: string): string {
  let seed = 0;
  for (let i = 0; i < label.length; i++) seed = (seed * 31 + label.charCodeAt(i)) | 0;
  const rnd = seeded(seed >>> 0);
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 44; i++) s += hex[Math.floor(rnd() * 16)];
  return s;
}

/** Genesis: ProtocolInitialized. */
export const GENESIS_TS = NOW - 560 * DAY;
export const genesisTxDigest = govDigest("genesis");

/** Parameter-change history (newest meaningful tunings of the protocol). */
export const paramHistory: GovParamChange[] = [
  {
    name: "protocol_fee_bps",
    oldValue: "50",
    newValue: "100",
    tsMs: NOW - 300 * DAY,
    txDigest: govDigest("param:fee"),
  },
  {
    name: "min_validator_stake",
    oldValue: "150000",
    newValue: "250000",
    tsMs: NOW - 240 * DAY,
    txDigest: govDigest("param:minstake"),
  },
  {
    name: "challenger_bond",
    oldValue: "20000",
    newValue: "25000",
    tsMs: NOW - 180 * DAY,
    txDigest: govDigest("param:bond"),
  },
  {
    name: "compensation_grace_ms",
    oldValue: "432000000",
    newValue: "604800000",
    tsMs: NOW - 90 * DAY,
    txDigest: govDigest("param:grace"),
  },
];

/** Treasury rotation history (ProtocolTreasuryChanged). */
export const treasuryHistory = [
  {
    oldTreasury: "0x7a5400000000000000000000000000000000000000000000000000000000old0",
    newTreasury: protocolConfig.treasury,
    tsMs: NOW - 210 * DAY,
    txDigest: govDigest("treasury:rotate"),
  },
];

/**
 * Pause history (EmergencyStopTriggered / ProtocolResumed). One past incident,
 * already resumed — `protocolConfig.paused` is the current (false) state. Flip
 * that flag to exercise the FE-M6 global pause banner.
 */
export const pauseHistory = [
  { paused: true, tsMs: NOW - 150 * DAY, txDigest: govDigest("pause:stop") },
  { paused: false, tsMs: NOW - 150 * DAY + 8 * 3_600_000, txDigest: govDigest("pause:resume") },
];

/* --------------------------------------------------------------------------
   Unified governance history (FE-M6 /governance feed)
-------------------------------------------------------------------------- */

export type GovEventKind = "init" | "param" | "treasury" | "pause" | "resume";

export interface GovHistoryEntry {
  kind: GovEventKind;
  tsMs: number;
  txDigest: string;
  title: string;
  detail: string;
}

/**
 * The full parameter-change history (FE-M6). On chain this is event-only — there
 * is no historical object read (§18.3 P3) — so the indexer/mock archives it.
 * Genesis + param tunings + treasury rotation + pause incidents, newest first;
 * mirrors the `governance` event feed so the page and the feed agree.
 */
export function governanceHistory(): GovHistoryEntry[] {
  const out: GovHistoryEntry[] = [
    {
      kind: "init",
      tsMs: GENESIS_TS,
      txDigest: genesisTxDigest,
      title: "Protocol initialized",
      detail: `Config created with v${protocolConfig.version} safe defaults`,
    },
  ];
  for (const p of paramHistory) {
    out.push({
      kind: "param",
      tsMs: p.tsMs,
      txDigest: p.txDigest,
      title: `Parameter changed — ${p.name}`,
      detail: `${p.oldValue} → ${p.newValue}`,
    });
  }
  for (const t of treasuryHistory) {
    out.push({
      kind: "treasury",
      tsMs: t.tsMs,
      txDigest: t.txDigest,
      title: "Treasury rotated",
      detail: `${t.oldTreasury.slice(0, 10)}… → ${t.newTreasury.slice(0, 10)}…`,
    });
  }
  for (const ph of pauseHistory) {
    out.push({
      kind: ph.paused ? "pause" : "resume",
      tsMs: ph.tsMs,
      txDigest: ph.txDigest,
      title: ph.paused ? "Emergency stop triggered" : "Protocol resumed",
      detail: ph.paused ? "Capital entry halted — exits stayed open (D6)" : "Normal operation restored",
    });
  }
  return out.sort((a, b) => b.tsMs - a.tsMs);
}
