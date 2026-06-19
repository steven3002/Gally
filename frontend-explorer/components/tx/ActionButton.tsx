"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx/useTx";
import { isBusy, TX_STATUS_LABEL } from "@/lib/tx/types";
import {
  INTENT_ENTRY,
  intentRoute,
  intentSummary,
  intentVerb,
  optimisticKey,
  type TxIntent,
} from "@/lib/tx/intents";
import { applyOptimistic, useOptimistic } from "@/lib/tx/optimistic";
import { isLive } from "@/lib/data";
import { SUI_NETWORK } from "@/lib/tx/config";
import { cn, num, shortDigest } from "@/lib/format";
import { Alert, Check, Close, Wallet } from "@/components/ui/icons";

type ButtonTone = "primary" | "positive" | "danger" | "warning" | "neutral";

const SOLID: Record<ButtonTone, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  positive: "bg-positive text-white hover:opacity-90",
  danger: "bg-danger text-white hover:opacity-90",
  warning: "bg-warning text-white hover:opacity-90",
  neutral: "bg-surface-3 text-foreground hover:bg-surface-2",
};

export interface ActionButtonProps {
  /** Build the intent for the given amount (amount is ignored for fixed actions). */
  getIntent: (amount: number) => TxIntent;
  /** When present, the modal shows an amount input; otherwise the action is fixed. */
  amount?: { label: string; max: number; default?: number; min?: number; suffix?: string };
  label?: string;
  icon?: ReactNode;
  tone?: ButtonTone;
  size?: "sm" | "md";
  variant?: "solid" | "ghost";
  /** When set, the trigger is disabled with this reason as its tooltip. */
  disabledReason?: string | null;
  block?: boolean;
  className?: string;
  /** Run after a successful execution (in addition to the built-in optimistic apply). */
  onSuccess?: (intent: TxIntent) => void;
  /** Opt out of the optimistic applied-chip reconciliation (default: on). */
  reconcile?: boolean;
  /** Label for the applied chip once this action has been submitted. */
  appliedLabel?: string;
}

export function ActionButton({
  getIntent,
  amount,
  label,
  icon,
  tone = "primary",
  size = "md",
  variant = "solid",
  disabledReason,
  block,
  className,
  onSuccess,
  reconcile = true,
  appliedLabel,
}: ActionButtonProps) {
  const { connected, connect } = useWallet();
  const { status, result, run, reset } = useTx();
  const { isApplied } = useOptimistic();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(amount?.default ?? amount?.max ?? 0);

  const busy = isBusy(status);
  const done = status === "success" && result?.ok;
  const failed = status === "error";

  const clamped = Math.max(amount?.min ?? 1, Math.min(amount?.max ?? value, value || 0));
  const intent = getIntent(amount ? clamped : 0);
  const verb = label ?? intentVerb(intent);
  const amountValid = !amount || (value >= (amount.min ?? 1) && value <= amount.max);
  // Optimistic reconciliation: once this action's (verb, subject) has been
  // submitted, collapse the trigger to an applied chip — across every page.
  const applied = reconcile && !open && isApplied(optimisticKey(intent));

  async function handleRun() {
    const res = await run(intent);
    if (res.ok) {
      if (reconcile) applyOptimistic(intent);
      onSuccess?.(intent);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isBusy(status)) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status]);

  function close() {
    setOpen(false);
    reset();
    setValue(amount?.default ?? amount?.max ?? 0);
  }

  const base = cn(
    "inline-flex items-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
    variant === "ghost" ? "border border-border bg-surface text-foreground hover:border-border-strong" : SOLID[tone],
    block && "w-full justify-center",
    className,
  );

  // Already submitted — the optimistic reflection (reconciled across pages).
  if (applied) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl font-semibold text-positive",
          size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
          "border border-positive/30 bg-positive-soft",
          block && "w-full justify-center",
          className,
        )}
        title="Submitted — your wallet's view updates once the indexer confirms."
      >
        <Check className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {appliedLabel ?? `${verb} submitted`}
      </span>
    );
  }

  // Disabled (state gate) — show the reason.
  if (disabledReason) {
    return (
      <button disabled className={base} title={disabledReason} aria-disabled="true">
        {icon}
        {verb}
      </button>
    );
  }

  // Disconnected — the trigger becomes "Connect wallet".
  if (!connected) {
    return (
      <button onClick={connect} className={base}>
        <Wallet className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} /> Connect wallet
      </button>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className={base}>
        {icon}
        {verb}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={verb}
        >
          <button
            className="absolute inset-0 cursor-default bg-black/50"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => !busy && close()}
          />
          <div className="motion-safe:animate-rise relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]">
            {/* header */}
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">{verb}</h3>
                <p className="mt-0.5 font-mono text-[11px] text-muted-2">{INTENT_ENTRY[intent.kind]}</p>
              </div>
              <button
                onClick={() => !busy && close()}
                disabled={busy}
                aria-label="Close"
                className="rounded-lg p-1 text-muted-2 transition-colors hover:text-foreground disabled:opacity-40"
              >
                <Close className="h-5 w-5" />
              </button>
            </div>

            {/* body */}
            <div className="space-y-4 px-5 py-4">
              {done ? (
                <div className="flex flex-col items-center gap-2 py-3 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-positive-soft text-positive">
                    <Check className="h-6 w-6" />
                  </span>
                  <p className="text-sm font-semibold text-foreground">{verb} confirmed</p>
                  {result?.digest && (
                    <p className="font-mono text-xs text-muted">{shortDigest(result.digest)}</p>
                  )}
                  {intentRoute(intent) && (
                    <Link href={intentRoute(intent)!} onClick={close} className="text-xs font-semibold text-primary hover:text-primary-strong">
                      View details →
                    </Link>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-muted">{intentSummary(intent)}</p>

                  {amount && (
                    <div>
                      <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
                        <span>{amount.label}</span>
                        <button
                          type="button"
                          onClick={() => setValue(amount.max)}
                          className="font-semibold text-primary hover:text-primary-strong"
                        >
                          Max {num(amount.max)}
                        </button>
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 focus-within:border-border-strong">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={amount.min ?? 1}
                          max={amount.max}
                          value={value === 0 ? "" : value}
                          disabled={busy}
                          onChange={(e) => setValue(Number(e.target.value))}
                          className="tnum w-full bg-transparent text-sm font-semibold text-foreground outline-none"
                          autoFocus
                        />
                        {amount.suffix && <span className="shrink-0 text-xs text-muted-2">{amount.suffix}</span>}
                      </div>
                      {!amountValid && (
                        <p className="mt-1 text-[11px] text-danger">Enter an amount between {num(amount.min ?? 1)} and {num(amount.max)}.</p>
                      )}
                    </div>
                  )}

                  {failed && (
                    <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                      <Alert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{result?.error ?? "Transaction failed."}</span>
                    </div>
                  )}

                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-2">
                    {isLive
                      ? `Live execution — this submits a real transaction to ${SUI_NETWORK} and your wallet will ask you to sign.`
                      : "Mock execution — no transaction is submitted (contract not yet deployed). The wallet signing flow swaps in once the protocol is live."}
                  </p>
                </>
              )}
            </div>

            {/* footer */}
            {!done && (
              <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
                <button
                  onClick={close}
                  disabled={busy}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
                >
                  Cancel
                </button>
                {failed ? (
                  <button
                    onClick={() => reset()}
                    className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold", SOLID[tone])}
                  >
                    Try again
                  </button>
                ) : (
                  <button
                    onClick={handleRun}
                    disabled={busy || !amountValid}
                    className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60", SOLID[tone])}
                  >
                    {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                    {busy ? TX_STATUS_LABEL[status] : `Confirm ${verb.toLowerCase()}`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
