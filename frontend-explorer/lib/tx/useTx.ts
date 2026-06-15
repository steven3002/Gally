"use client";

import { useCallback, useState } from "react";
import { executeIntent, type ExecuteOpts } from "./executor";
import { intentRoute, intentTone, intentVerb, type TxIntent } from "./intents";
import type { TxResult, TxStatus } from "./types";
import { pushNotification, type AppNotification } from "@/lib/notifications";
import { shortDigest } from "@/lib/format";

/**
 * Client hook that drives one intent through the (mock now / live later) executor
 * and archives the outcome in the notification store. Components call `run(intent)`
 * from a click handler and render `status`/`result`. (`Date.now()` here is in an
 * event path, not a render/derivation path — guard_rails §2.6 is preserved.)
 */
export function useTx() {
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

function notificationFor(intent: TxIntent, res: TxResult): Omit<AppNotification, "read"> {
  const verb = intentVerb(intent);
  if (res.ok) {
    return {
      id: `tx-${res.digest}`,
      kind: "tx",
      tone: intentTone(intent),
      title: `${verb} confirmed`,
      body: res.digest ? `Transaction ${shortDigest(res.digest)} succeeded.` : undefined,
      route: intentRoute(intent),
      tsMs: Date.now(),
    };
  }
  return {
    id: `tx-fail-${Date.now()}`,
    kind: "tx",
    tone: "danger",
    title: `${verb} failed`,
    body: res.error ?? "The transaction did not complete.",
    route: intentRoute(intent),
    tsMs: Date.now(),
  };
}
