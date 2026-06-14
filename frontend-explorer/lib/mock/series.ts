import type { Point } from "../types";
import { DAY } from "../format";

/** Deterministic PRNG (mulberry32) so every render — server & client — matches. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monotonic ramp from 0→total over `n` points ending at `endMs`, S-curve shaped. */
export function rampSeries(
  total: number,
  n: number,
  endMs: number,
  stepMs: number,
  seed: number,
): Point[] {
  const rnd = seeded(seed);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    // logistic-ish progress with mild noise, clamped monotonic
    const base = 1 / (1 + Math.exp(-9 * (x - 0.5)));
    const noisy = base * (0.94 + rnd() * 0.12);
    out.push({ t: endMs - (n - 1 - i) * stepMs, v: 0 });
    out[i].v = Math.round(total * Math.min(1, noisy));
  }
  // enforce monotonic non-decreasing
  for (let i = 1; i < out.length; i++) if (out[i].v < out[i - 1].v) out[i].v = out[i - 1].v;
  out[out.length - 1].v = total;
  return out;
}

/** Monotonic, mostly-linear accrual (used for the yield index) with small jumps. */
export function accrualSeries(
  total: number,
  n: number,
  endMs: number,
  stepMs: number,
  seed: number,
): Point[] {
  const rnd = seeded(seed);
  const weights: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.4 + rnd() * 1.2; // some periods earn more
    weights.push(w);
    sum += w;
  }
  let acc = 0;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    acc += (weights[i] / sum) * total;
    out.push({ t: endMs - (n - 1 - i) * stepMs, v: Math.round(acc * 1000) / 1000 });
  }
  out[out.length - 1].v = total;
  return out;
}

/** Mean-reverting walk between lo..hi (used for wrapped-supply over time). */
export function walkSeries(
  lo: number,
  hi: number,
  n: number,
  endMs: number,
  stepMs: number,
  seed: number,
): Point[] {
  const rnd = seeded(seed);
  const mid = (lo + hi) / 2;
  let v = mid;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const pull = (mid - v) * 0.18;
    v += pull + (rnd() - 0.5) * (hi - lo) * 0.28;
    v = Math.max(lo, Math.min(hi, v));
    out.push({ t: endMs - (n - 1 - i) * stepMs, v: Math.round(v) });
  }
  return out;
}

export function spark(points: Point[], take = 24): number[] {
  if (points.length <= take) return points.map((p) => p.v);
  const step = points.length / take;
  const out: number[] = [];
  for (let i = 0; i < take; i++) out.push(points[Math.floor(i * step)].v);
  out.push(points[points.length - 1].v);
  return out;
}

export const DAYS = DAY;
