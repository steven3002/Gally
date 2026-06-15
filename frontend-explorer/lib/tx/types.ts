// Transaction execution seam — shared types (FE-M7.2, spec §6.1).
// The component tree builds typed INTENTS; the executor drives a lifecycle.
// Mock now; the live executor (real wallet/PTB) swaps in at FE-M8 behind this seam.

export type TxStatus =
  | "idle"
  | "building" // assembling the (future) PTB
  | "signing" // awaiting wallet signature
  | "pending" // submitted, awaiting effects
  | "success"
  | "error";

export interface TxLifecycle {
  status: TxStatus;
  digest?: string;
  error?: string;
}

export interface TxResult {
  ok: boolean;
  digest?: string;
  error?: string;
}

/** Human-readable label per status (drives the inline button/modal copy). */
export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  idle: "Ready",
  building: "Building transaction…",
  signing: "Awaiting signature…",
  pending: "Submitting…",
  success: "Confirmed",
  error: "Failed",
};

/** Whether a status is a terminal (non-busy) state. */
export function isBusy(status: TxStatus): boolean {
  return status === "building" || status === "signing" || status === "pending";
}
