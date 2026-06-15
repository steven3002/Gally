import type { AssetState, Category, DisputeStatus } from "./types";

/** Fixed "now" so server/client render identically (no hydration drift). */
export const NOW = Date.parse("2026-06-14T12:00:00Z");

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** className join helper. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** USDC formatting. Mock amounts are stored as whole USDC. */
export function usd(n: number, opts?: { sign?: boolean }): string {
  const s = `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (opts?.sign) return (n >= 0 ? "+" : "−") + s;
  return n < 0 ? "−" + s : s;
}

export function usdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1e3).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function num(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function numCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function pctSigned(n: number, digits = 1): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;
}

export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Shorten a 0x address: 0x1f2e…9a3c */
export function shortAddr(a: string, lead = 6, tail = 4): string {
  if (!a.startsWith("0x")) return a;
  if (a.length <= lead + tail + 2) return a;
  return `${a.slice(0, lead)}…${a.slice(-tail)}`;
}

export function shortDigest(d: string): string {
  return d.length > 10 ? `${d.slice(0, 6)}…${d.slice(-4)}` : d;
}

/** Truncate a content hash (sha256, `0x`+64 hex) for display: 0x1a2b3c4d…9f8e7d6c */
export function shortHash(h: string, lead = 10, tail = 8): string {
  if (h.length <= lead + tail + 1) return h;
  return `${h.slice(0, lead)}…${h.slice(-tail)}`;
}

/** External Sui explorer deep-link (real once the package is deployed). */
export function suiscanUrl(
  id: string,
  kind: "object" | "account" | "tx" = "object",
): string {
  const seg = kind === "tx" ? "tx" : kind === "account" ? "account" : "object";
  return `https://suiscan.xyz/testnet/${seg}/${id}`;
}

/** Relative time vs the fixed NOW. */
export function relTime(ms: number): string {
  const diff = ms - NOW;
  const past = diff <= 0;
  const a = Math.abs(diff);
  const fmt = (v: number, unit: string) =>
    past ? `${v}${unit} ago` : `in ${v}${unit}`;
  if (a < 60_000) return past ? "just now" : "in moments";
  if (a < HOUR) return fmt(Math.round(a / 60_000), "m");
  if (a < DAY) return fmt(Math.round(a / HOUR), "h");
  if (a < 30 * DAY) return fmt(Math.round(a / DAY), "d");
  if (a < 365 * DAY) return fmt(Math.round(a / (30 * DAY)), "mo");
  return fmt(Math.round(a / (365 * DAY)), "y");
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function monthDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function daysLeft(ms: number): number {
  return Math.max(0, Math.round((ms - NOW) / DAY));
}

export function pctOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, (part / whole) * 100);
}

/* ----------------------------- presentation maps ----------------------------- */

export const STATE_LABEL: Record<AssetState, string> = {
  PENDING_VOUCH: "Pending vouch",
  FUNDING: "Funding",
  FUNDED: "Funded",
  EXECUTING: "Executing",
  OPERATIONAL: "Operational",
  DEFAULTED: "Defaulted",
  COMPENSATING: "Compensating",
  CLOSED: "Closed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** Tone → static Tailwind class trio (kept literal so Tailwind can scan them). */
export type Tone = "primary" | "positive" | "warning" | "danger" | "info" | "neutral";

export const TONE_CLASS: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary border-primary/20",
  positive: "bg-positive-soft text-positive border-positive/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  info: "bg-info-soft text-info border-info/20",
  neutral: "bg-surface-2 text-muted border-border",
};

export const STATE_TONE: Record<AssetState, Tone> = {
  PENDING_VOUCH: "neutral",
  FUNDING: "primary",
  FUNDED: "info",
  EXECUTING: "info",
  OPERATIONAL: "positive",
  DEFAULTED: "danger",
  COMPENSATING: "warning",
  CLOSED: "neutral",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export const DISPUTE_TONE: Record<DisputeStatus, Tone> = {
  OPEN: "warning",
  UPHELD: "danger",
  REJECTED: "positive",
  EXPIRED: "neutral",
};

export const CATEGORY_TONE: Record<Category, Tone> = {
  Housing: "primary",
  Machinery: "info",
  "Trade Finance": "warning",
  Agriculture: "positive",
  Energy: "danger",
  Infrastructure: "neutral",
};

/** Fixed category hex colours for charts/donuts (allocation, distribution). */
export const CATEGORY_COLOR: Record<Category, string> = {
  Housing: "#5e7e2a",
  Energy: "#e5484d",
  "Trade Finance": "#e89110",
  Agriculture: "#0fb39a",
  Machinery: "#4593e6",
  Infrastructure: "#8b8f9e",
};
