import type { ReactNode } from "react";
import type { AssetState, DisputeStatus } from "@/lib/types";
import {
  cn,
  DISPUTE_TONE,
  STATE_LABEL,
  STATE_TONE,
} from "@/lib/format";
import { Pill } from "./primitives";
import { TrendDown, TrendUp } from "./icons";

export { Pill };

export function StatePill({ state, className }: { state: AssetState; className?: string }) {
  const live = state === "FUNDING" || state === "OPERATIONAL";
  return (
    <Pill tone={STATE_TONE[state]} className={className} dot={live}>
      {STATE_LABEL[state]}
    </Pill>
  );
}

export function DisputeStatusPill({ status }: { status: DisputeStatus }) {
  return (
    <Pill tone={DISPUTE_TONE[status]} dot={status === "OPEN"}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Pill>
  );
}

export function MetricTag({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold tnum",
        up ? "text-positive" : "text-danger",
        className,
      )}
    >
      {up ? <TrendUp className="h-3.5 w-3.5" /> : <TrendDown className="h-3.5 w-3.5" />}
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}

export function KV({
  label,
  children,
  className,
  mono,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2.5", className)}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd
        className={cn(
          "text-sm font-medium text-foreground tnum text-right",
          mono && "font-mono text-[13px]",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function Bar({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}
