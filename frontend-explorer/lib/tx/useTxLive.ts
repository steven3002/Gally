"use client";

// FE-M8b — Live transaction hook (dapp-kit). Same `{ status, result, run, reset }`
// shape as the mock `useTx`, so the action forms never change. Selected over the mock
// by `isLive` (see `useTx.ts`). Builds the PTB, signs+submits via the connected wallet,
// archives the outcome in the shared notification store.

import { useCallback, useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { executeIntentLive } from "./executorLive";
import { buildCtx } from "./buildCtx";
import { resolveLiveRefs } from "./resolve";
import type { ExecuteOpts } from "./executor";
import { notificationFor } from "./notify";
import type { TxIntent } from "./intents";
import type { TxResult, TxStatus } from "./types";
import { pushNotification } from "@/lib/notifications";

export function useTxLive() {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [result, setResult] = useState<TxResult | null>(null);
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const run = useCallback(
    async (intent: TxIntent, opts?: ExecuteOpts): Promise<TxResult> => {
      setResult(null);
      if (!account) {
        const res: TxResult = { ok: false, error: "Connect a wallet to continue." };
        setStatus("error");
        setResult(res);
        pushNotification(notificationFor(intent, res));
        return res;
      }
      // Resolve the accumulator/pool ids, entity token <T>, and the sender's owned
      // objects from the indexer + wallet RPC before building the PTB.
      setStatus("building");
      opts?.onStep?.({ status: "building" });
      const resolved = await resolveLiveRefs(client, intent, account.address);
      const res = await executeIntentLive(intent, {
        ctx: buildCtx(intent, account.address, resolved),
        signAndExecute: async (tx) => {
          const r = await signAndExecute({ transaction: tx });
          return { digest: r.digest };
        },
        onStep: (l) => {
          setStatus(l.status);
          opts?.onStep?.(l);
        },
      });
      setResult(res);
      pushNotification(notificationFor(intent, res));
      return res;
    },
    [account, client, signAndExecute],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
  }, []);

  return { status, result, run, reset };
}
