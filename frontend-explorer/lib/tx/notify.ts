// FE-M8 — Shared notification builder for a finished transaction (mock + live both
// archive the same way). Extracted so `useTx` and `useTxLive` agree on copy.

import { intentRoute, intentTone, intentVerb, type TxIntent } from "./intents";
import type { TxResult } from "./types";
import type { AppNotification } from "@/lib/notifications";
import { shortDigest } from "@/lib/format";

export function notificationFor(intent: TxIntent, res: TxResult): Omit<AppNotification, "read"> {
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
