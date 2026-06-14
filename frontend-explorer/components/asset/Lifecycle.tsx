import type { Asset, AssetState, ProtocolEvent } from "@/lib/types";
import { cn, relTime, shortDate } from "@/lib/format";
import { Check, Close, Alert, Dot } from "@/components/ui/icons";

type StepStatus = "done" | "current" | "future" | "bad";
interface Step {
  label: string;
  status: StepStatus;
}

const HAPPY = ["Listed", "Funding", "Funded", "Executing", "Operational", "Closed"];
const HAPPY_INDEX: Partial<Record<AssetState, number>> = {
  PENDING_VOUCH: 0,
  FUNDING: 1,
  FUNDED: 2,
  EXECUTING: 3,
  OPERATIONAL: 4,
  CLOSED: 5,
};

function steps(state: AssetState): Step[] {
  if (state === "FAILED")
    return [
      { label: "Listed", status: "done" },
      { label: "Funding", status: "done" },
      { label: "Failed", status: "bad" },
    ];
  if (state === "CANCELLED")
    return [
      { label: "Listed", status: "done" },
      { label: "Cancelled", status: "bad" },
    ];
  if (state === "DEFAULTED")
    return [
      { label: "Funded", status: "done" },
      { label: "Executing", status: "done" },
      { label: "Defaulted", status: "bad" },
    ];
  if (state === "COMPENSATING")
    return [
      { label: "Executing", status: "done" },
      { label: "Defaulted", status: "bad" },
      { label: "Compensating", status: "current" },
      { label: "Closed", status: "future" },
    ];
  const cur = HAPPY_INDEX[state] ?? 0;
  return HAPPY.map((label, i) => ({
    label,
    status: i < cur ? "done" : i === cur ? "current" : "future",
  }));
}

export function StageStepper({ asset }: { asset: Asset }) {
  const list = steps(asset.state);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {list.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                s.status === "done" && "bg-positive text-white",
                s.status === "current" && "bg-primary text-white ring-4 ring-primary-soft",
                s.status === "future" && "bg-surface-3 text-muted-2",
                s.status === "bad" && "bg-danger text-white",
              )}
            >
              {s.status === "done" ? (
                <Check className="h-3.5 w-3.5" />
              ) : s.status === "bad" ? (
                <Close className="h-3.5 w-3.5" />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(
                "whitespace-nowrap text-xs font-medium",
                s.status === "future" ? "text-muted-2" : "text-foreground",
              )}
            >
              {s.label}
            </span>
          </div>
          {i < list.length - 1 && (
            <span
              className={cn(
                "mx-1 h-px w-6 shrink-0",
                list[i + 1].status === "future" ? "bg-border" : "bg-positive/50",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function LifecycleTimeline({ events }: { events: ProtocolEvent[] }) {
  const lifecycle = events
    .filter((e) => e.feed === "lifecycle" || e.type === "RaiseFinalized" || e.type === "RaiseAborted")
    .sort((a, b) => a.tsMs - b.tsMs);

  return (
    <ol className="relative space-y-5 pl-6">
      <span className="absolute bottom-2 left-[7px] top-2 w-px bg-border" />
      {lifecycle.map((e) => {
        const bad =
          e.type === "EntityDefaulted" || e.type === "RaiseAborted";
        return (
          <li key={e.id} className="relative">
            <span
              className={cn(
                "absolute -left-6 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-surface",
                bad ? "bg-danger" : "bg-primary",
              )}
            >
              {bad ? (
                <Alert className="h-2.5 w-2.5 text-white" />
              ) : (
                <Dot className="h-1.5 w-1.5 text-white" />
              )}
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-foreground">{e.summary}</p>
              <time className="shrink-0 text-xs text-muted-2">{shortDate(e.tsMs)}</time>
            </div>
            {e.meta && <p className="mt-0.5 text-xs text-muted">{e.meta}</p>}
            <p className="mt-0.5 text-[11px] text-muted-2">{relTime(e.tsMs)}</p>
          </li>
        );
      })}
    </ol>
  );
}
