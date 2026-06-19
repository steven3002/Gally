"use client";

import { useCallback, useState } from "react";
import { executeIntent, type ExecuteOpts } from "./executor";
import { type TxIntent } from "./intents";
import type { TxResult, TxStatus } from "./types";
import { pushNotification } from "@/lib/notifications";
import { notificationFor } from "./notify";
import { isLive } from "@/lib/data";
import { useTxLive } from "./useTxLive";

/**
 * Client hook that drives one intent through the executor (mock by default; the real
 * PTB executor when `NEXT_PUBLIC_DATA_SOURCE=live`) and archives the outcome in the
 * notification store. Components call `run(intent)` and render `status`/`result`.
 *
 * The mock vs. live choice is a BUILD-TIME constant (`isLive`), so `useTx` is a stable
 * alias of exactly one hook for the app's lifetime — no rules-of-hooks violation, and
 * the mock build never pulls the wallet into the render path. (`Date.now()` here is in
 * an event path, not a render/derivation path — guard_rails §2.6 is preserved.)
 */
function useTxMock() {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [result, setResult] = useState<TxResult | null>(null);

  const run = useCallback(async (intent: TxIntent, opts?: ExecuteOpts): Promise<TxResult> => {
    setResult(null);
    const res = await executeIntent(intent, {
      ...opts,
      onStep: (l) => {
        setStatus(l.status);
        opts?.onStep?.(l);
      },
    });
    setResult(res);
    pushNotification(notificationFor(intent, res));
    return res;
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
  }, []);

  return { status, result, run, reset };
}

/**
 * The hook the component tree imports. A build-time alias of the mock or live driver —
 * both expose the identical `{ status, result, run, reset }` surface.
 */
export const useTx = isLive ? useTxLive : useTxMock;
