import type { NextDeadline, DeadlineRisk } from "@/lib/mock/health";
import { cn, relTime, shortDate, usd, type Tone } from "@/lib/format";
import { Clock, Alert } from "@/components/ui/icons";

const RISK_TONE: Record<DeadlineRisk, Tone> = {
  ok: "info",
  soon: "warning",
  overdue: "danger",
};

/**
 * Forward-looking default-risk clock (FE-M5, Flow J §14): the next unreleased
 * tranche's deadline. Once `now > deadline` with the proof unapproved, anyone may
 * `flag_default` — so an overdue clock is an actionable warning, not just history.
 */
export function DefaultRiskClock({ next }: { next: NextDeadline }) {
  const tone = RISK_TONE[next.risk];
  const cls: Record<Tone, string> = {
    info: "border-info/30 bg-info-soft text-info",
    warning: "border-warning/30 bg-warning-soft text-warning",
    danger: "border-danger/30 bg-danger-soft text-danger",
    primary: "",
    positive: "",
    neutral: "",
  };
  const headline = next.overdue
    ? `Milestone ${next.index + 1} overdue by ${Math.abs(next.daysLeft)} day${Math.abs(next.daysLeft) === 1 ? "" : "s"}`
    : `Milestone ${next.index + 1} due ${relTime(next.deadlineMs)}`;
  const Icon = next.overdue ? Alert : Clock;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3", cls[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-xs">
        <div className="font-semibold">{headline}</div>
        <div className="mt-0.5 opacity-80">
          {next.description} · {usd(next.amount)} · deadline {shortDate(next.deadlineMs)}.
          {next.overdue
            ? " The deadline passed with no approved proof — anyone can flag a default."
            : next.risk === "soon"
              ? " The entity must submit proof and the validator must approve it before the deadline."
              : " On track."}
        </div>
      </div>
    </div>
  );
}
