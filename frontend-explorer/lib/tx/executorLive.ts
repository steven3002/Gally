// FE-M8b — Live transaction executor (real PTB + connected wallet).
//
// Same `(intent) => TxResult` contract + lifecycle as the mock `executeIntent`, so the
// component tree never changes — only the engine. Builds the PTB from the Move
// signatures (`ptb.ts`), signs+submits through the wallet adapter, and surfaces the
// real digest / status / a humanized MoveAbort. Selected over the mock by `isLive` at
// module load (see `useTx.ts`).

import type { Transaction } from "@mysten/sui/transactions";
import { validateIntent, type TxIntent } from "./intents";
import { buildPlan, planToTransaction, type BuildCtx } from "./ptb";
import type { TxLifecycle, TxResult } from "./types";

/** A wallet sign+execute callback (dapp-kit `useSignAndExecuteTransaction`). */
export type SignAndExecute = (tx: Transaction) => Promise<{ digest: string }>;

export interface LiveOpts {
  ctx: BuildCtx;
  signAndExecute: SignAndExecute;
  onStep?: (l: TxLifecycle) => void;
}

/** Turn a raw chain/SDK error into a one-line human message. */
export function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Sui MoveAbort messages carry the abort code as the 2nd arg, INSIDE the parens
  // and after the `MoveLocation { … }` struct: `MoveAbort(MoveLocation {…}, 300)`.
  const abort = msg.match(/MoveAbort\([\s\S]*?,\s*(\d+)\s*\)/);
  if (abort) return `Transaction aborted by the contract (code ${abort[1]}).`;
  if (/MoveAbort|abort(ed)?\b/i.test(msg)) return "Transaction aborted by the contract.";
  if (/rejected|denied|cancell?ed/i.test(msg)) return "Transaction rejected in wallet.";
  if (/Insufficient|gas/i.test(msg)) return "Insufficient balance or gas for this transaction.";
  if (/unresolved/i.test(msg)) return msg; // our own BuildError — already human
  return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
}

export async function executeIntentLive(intent: TxIntent, opts: LiveOpts): Promise<TxResult> {
  const step = (l: TxLifecycle) => opts.onStep?.(l);

  const invalid = validateIntent(intent);
  if (invalid) {
    step({ status: "error", error: invalid });
    return { ok: false, error: invalid };
  }

  step({ status: "building" });
  let tx: Transaction;
  try {
    tx = planToTransaction(buildPlan(intent, opts.ctx), opts.ctx);
  } catch (e) {
    const error = humanizeError(e);
    step({ status: "error", error });
    return { ok: false, error };
  }

  step({ status: "signing" });
  try {
    const res = await opts.signAndExecute(tx);
    step({ status: "pending", digest: res.digest });
    step({ status: "success", digest: res.digest });
    return { ok: true, digest: res.digest };
  } catch (e) {
    const error = humanizeError(e);
    step({ status: "error", error });
    return { ok: false, error };
  }
}
