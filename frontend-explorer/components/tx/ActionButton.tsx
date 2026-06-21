"use client";

import { useState, type ReactNode } from "react";
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
import { cn, num, shortDigest, usd } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";
import { Alert, Check, Wallet } from "@/components/ui/icons";

type ButtonTone = "primary" | "positive" | "danger" | "warning" | "neutral";

const SOLID: Record<ButtonTone, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-strong",
  positive: "bg-positive text-white hover:opacity-90",
  danger: "bg-danger text-white hover:opacity-90",
  warning: "bg-warning text-white hover:opacity-90",
  neutral: "bg-surface-3 text-foreground hover:bg-surface-2",
};

/** Amount-input configuration: the unit being entered, plus what drives the info panel. */
export interface AmountConfig {
  /** Field label (e.g. "Amount to invest"). */
  label: string;
  /** Hard ceiling for the amount (remaining capacity / holding size). */
  max: number;
  default?: number;
  min?: number;
  /** Unit shown inside the input box (e.g. "USDC", "deeds"). */
  suffix?: string;
  /** What the user ends up with — drives the "You receive" line (e.g. "shares"). */
  unit?: string;
  /** USDC price per `unit`; enables the price + receive rows. */
  unitPrice?: number;
  /** Spendable wallet balance in the input's unit. Caps Max, drives the % chips, shown as a row. */
  balance?: number;
  /** Row label for the `max` capacity (e.g. "Remaining in raise", "Your deeds"). */
  availableLabel?: string;
  /** Extra info rows appended below the derived ones. */
  info?: { label: string; value: string }[];
}

export interface ActionButtonProps {
  /** Build the intent for the given amount (amount is ignored for fixed actions). */
  getIntent: (amount: number) => TxIntent;
  /** When present, the modal shows the rich amount field; otherwise the action is fixed. */
  amount?: AmountConfig;
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

const PERCENTS: ReadonlyArray<readonly [string, number]> = [
  ["25%", 0.25],
  ["50%", 0.5],
  ["75%", 0.75],
];

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

  const hardMax = amount?.max ?? 0;
  // Spendable ceiling: capped by the wallet balance when one is supplied (live mode).
  const spendCap = amount?.balance != null ? Math.max(0, Math.min(hardMax, Math.floor(amount.balance))) : hardMax;

  const min = amount?.min ?? 1;
  const clamped = Math.max(min, Math.min(hardMax || value, value || 0));
  const intent = getIntent(amount ? clamped : 0);
  const verb = label ?? intentVerb(intent);

  const overBalance = amount?.balance != null && value > amount.balance;
  const amountValid = !amount || (value >= min && value <= hardMax && !overBalance);
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

      <Modal
        open={open}
        onClose={close}
        busy={busy}
        label={verb}
        subtitle={<p className="font-mono text-[11px] text-muted-2">{INTENT_ENTRY[intent.kind]}</p>}
        footer={
          done ? undefined : failed ? (
            <>
              <CancelButton onClick={close} busy={busy} />
              <button
                onClick={() => reset()}
                className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold", SOLID[tone])}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <CancelButton onClick={close} busy={busy} />
              <button
                onClick={handleRun}
                disabled={busy || !amountValid}
                className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60", SOLID[tone])}
              >
                {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                {busy ? TX_STATUS_LABEL[status] : `Confirm ${verb.toLowerCase()}`}
              </button>
            </>
          )
        }
      >
        {done ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-positive-soft text-positive">
              <Check className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-foreground">{verb} confirmed</p>
            {result?.digest && <p className="font-mono text-xs text-muted">{shortDigest(result.digest)}</p>}
            {intentRoute(intent) && (
              <Link href={intentRoute(intent)!} onClick={close} className="text-xs font-semibold text-primary hover:text-primary-strong">
                View details →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">{intentSummary(intent)}</p>

            {amount && (
              <AmountField
                cfg={amount}
                value={value}
                setValue={setValue}
                busy={busy}
                spendCap={spendCap}
                invalid={!amountValid}
                overBalance={overBalance}
              />
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
          </div>
        )}
      </Modal>
    </>
  );
}

function CancelButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
    >
      Cancel
    </button>
  );
}

/**
 * The rich amount field: a large number input, 25/50/75/Max quick-fill chips (sized to
 * the spendable cap), and a derived info panel (price, units received, capacity, wallet
 * balance, max affordable). All rows are derived from `cfg`, so verbs without a price or
 * balance (wrap/unwrap/split) just show the capacity row.
 */
function AmountField({
  cfg,
  value,
  setValue,
  busy,
  spendCap,
  invalid,
  overBalance,
}: {
  cfg: AmountConfig;
  value: number;
  setValue: (n: number) => void;
  busy: boolean;
  spendCap: number;
  invalid: boolean;
  overBalance: boolean;
}) {
  const min = cfg.min ?? 1;
  const price = cfg.unitPrice;
  const unit = cfg.unit;
  const inUnits = (n: number) => (price && price > 0 ? n / price : n);
  const withSuffix = (n: number) => `${num(n)}${cfg.suffix ? ` ${cfg.suffix}` : ""}`;
  const capacityValue = unit ? `${num(inUnits(cfg.max))} ${unit}` : withSuffix(cfg.max);

  const rows: { label: string; value: string; strong?: boolean }[] = [];
  if (price != null) rows.push({ label: "Price", value: usd(price) });
  if (unit) rows.push({ label: "You receive", value: `≈ ${num(inUnits(value || 0))} ${unit}`, strong: true });
  rows.push({ label: cfg.availableLabel ?? "Available", value: capacityValue });
  if (cfg.balance != null) {
    rows.push({ label: "Wallet balance", value: withSuffix(cfg.balance) });
    rows.push({
      label: "Max you can buy",
      value: unit ? `${num(inUnits(spendCap))} ${unit}` : withSuffix(spendCap),
    });
  }
  if (cfg.info) rows.push(...cfg.info);

  const chip = (active: boolean) =>
    cn(
      "rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
      active
        ? "border-primary bg-primary-soft text-primary"
        : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
    );

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
          <span>{cfg.label}</span>
          {cfg.balance != null && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setValue(spendCap)}
              className="text-muted-2 transition-colors hover:text-foreground disabled:opacity-50"
            >
              Balance <span className="tnum font-semibold text-foreground">{num(cfg.balance)}</span>
              {cfg.suffix ? ` ${cfg.suffix}` : ""}
            </button>
          )}
        </div>

        <div
          className={cn(
            "flex items-center gap-2 rounded-xl border bg-surface-2 px-3 py-2.5 transition-colors",
            invalid ? "border-danger/50" : "border-border focus-within:border-border-strong",
          )}
        >
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={cfg.max}
            value={value === 0 ? "" : value}
            disabled={busy}
            onChange={(e) => setValue(Number(e.target.value))}
            className="tnum w-full bg-transparent text-lg font-bold text-foreground outline-none"
            placeholder="0"
            autoFocus
          />
          {cfg.suffix && <span className="shrink-0 text-sm font-semibold text-muted-2">{cfg.suffix}</span>}
        </div>

        {/* quick-fill chips */}
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {PERCENTS.map(([lbl, f]) => {
            const target = Math.max(0, Math.floor(spendCap * f));
            return (
              <button
                key={lbl}
                type="button"
                disabled={busy}
                onClick={() => setValue(target)}
                className={chip(value > 0 && value === target)}
              >
                {lbl}
              </button>
            );
          })}
          <button
            type="button"
            disabled={busy}
            onClick={() => setValue(spendCap)}
            className={chip(value > 0 && value === spendCap)}
          >
            Max
          </button>
        </div>

        {invalid && (
          <p className="mt-1.5 text-[11px] text-danger">
            {overBalance
              ? "Amount exceeds your wallet balance."
              : `Enter an amount between ${num(min)} and ${num(cfg.max)}.`}
          </p>
        )}
      </div>

      {/* derived info panel */}
      <dl className="space-y-1.5 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-xs">
            <dt className="text-muted">{r.label}</dt>
            <dd className={cn("tnum font-semibold", r.strong ? "text-foreground" : "text-muted-2")}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
