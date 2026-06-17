"use client";

import type { CrankOp } from "@/lib/mock/cranks";
import { NOW, relTime, shortDate } from "@/lib/format";
import { ActionButton } from "./ActionButton";
import { Clock, Wrench } from "@/components/ui/icons";

/**
 * One permissionless crank, gated on its on-chain precondition (FE-M7.2, §2.2 #9).
 * When the precondition is met it is a real action routed through the same tx seam
 * (any connected user may run it — exit/keeper calls carry no pause gate). When it
 * is not yet runnable it renders an inert chip stating exactly why, and — for the
 * time-gated cranks — when it unlocks. Components build the intent only.
 */
export function CrankButton({ op, size = "sm" }: { op: CrankOp; size?: "sm" | "md" }) {
  if (!op.eligible) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted-2"
        title={op.reason}
      >
        <Clock className="h-3.5 w-3.5" />
        {op.availableAtMs && op.availableAtMs > NOW
          ? `${op.label} — available ${relTime(op.availableAtMs)}`
          : `${op.label} — not yet eligible`}
      </span>
    );
  }
  return (
    <ActionButton
      size={size}
      variant="ghost"
      tone="primary"
      icon={<Wrench className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />}
      label={op.label}
      appliedLabel={`${op.label} submitted`}
      getIntent={() => ({
        kind: "crank",
        crank: op.crank,
        targetId: op.targetId,
        label: op.label,
        route: op.route,
      })}
    />
  );
}

/** Inline meta line for a crank op (used by the keeper page / panel rows). */
export function CrankMeta({ op }: { op: CrankOp }) {
  return (
    <p className="text-[11px] text-muted-2">
      <span className="font-mono">{op.entry}</span>
      {op.availableAtMs ? ` · unlocks ${shortDate(op.availableAtMs)}` : ""}
    </p>
  );
}
