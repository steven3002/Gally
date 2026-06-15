// Mock transaction executor (FE-M7.2, spec §6.1).
//
// Drives an intent through build → sign → pending → success|error with
// deterministic latency and a deterministic digest, validating first so the
// error path is real (mirrors a contract abort). NO `Date.now()`/`Math.random()`.
//
// At FE-M8 a sibling `executeIntentLive` (PTB + `@mysten/dapp-kit`) is selected
// by an env flag behind this same signature — components never change.

import { validateIntent, type TxIntent } from "./intents";
import type { TxLifecycle, TxResult } from "./types";

export interface ExecuteOpts {
  onStep?: (l: TxLifecycle) => void;
  /** Skip the simulated latency (unit tests). */
  instant?: boolean;
  /** Force a post-signature failure (to exercise the error path). */
  forceError?: boolean;
}

function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic 0x + 32-hex pseudo-digest for an intent. */
export function mockDigest(intent: TxIntent): string {
  const s = JSON.stringify(intent);
  const a = fnv(s, 2166136261);
  const b = fnv(s, 0x9e3779b1);
  const c = fnv(`${s}|c`, a);
  const d = fnv(`${s}|d`, b);
  return "0x" + [a, b, c, d].map((x) => x.toString(16).padStart(8, "0")).join("");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function executeIntent(intent: TxIntent, opts: ExecuteOpts = {}): Promise<TxResult> {
  const step = (l: TxLifecycle) => opts.onStep?.(l);
  const wait = (ms: number) => (opts.instant ? Promise.resolve() : sleep(ms));

  const invalid = validateIntent(intent);
  if (invalid) {
    step({ status: "error", error: invalid });
    return { ok: false, error: invalid };
  }

  step({ status: "building" });
  await wait(350);
  step({ status: "signing" });
  await wait(550);

  if (opts.forceError) {
    const error = "Transaction rejected in wallet.";
    step({ status: "error", error });
    return { ok: false, error };
  }

  const digest = mockDigest(intent);
  step({ status: "pending", digest });
  await wait(700);
  step({ status: "success", digest });
  return { ok: true, digest };
}
