import type { Asset, Tranche } from "@/lib/types";
import { cn, NOW, shortDate, usd } from "@/lib/format";
import { proofOf } from "@/lib/mock/documents";
import { Pill } from "@/components/ui/primitives";
import { WalrusDoc } from "@/components/ui/WalrusDoc";
import { Check, Clock, Doc, Lock } from "@/components/ui/icons";

function status(t: Tranche, prevReleased: boolean) {
  if (t.released) return { label: "Released", tone: "positive" as const, icon: Check };
  if (t.approvedBy) return { label: "Approved", tone: "info" as const, icon: Doc };
  if (!prevReleased) return { label: "Locked", tone: "neutral" as const, icon: Lock };
  return { label: "Pending proof", tone: "warning" as const, icon: Clock };
}

export function TrancheList({ asset }: { asset: Asset }) {
  return (
    <div className="space-y-3">
      {asset.tranches.map((t, i) => {
        const prevReleased = i === 0 || asset.tranches[i - 1].released;
        const s = status(t, prevReleased);
        const Icon = s.icon;
        const overdue = !t.released && t.deadlineMs < NOW;
        const proof = proofOf(asset.id, t.index);
        return (
          <div
            key={t.index}
            className={cn(
              "rounded-2xl border p-4",
              t.released ? "border-border bg-surface-2/40" : "border-border bg-surface",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold",
                  t.released
                    ? "bg-positive-soft text-positive"
                    : s.tone === "info"
                      ? "bg-info-soft text-info"
                      : "bg-surface-3 text-muted",
                )}
              >
                {t.index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="truncate text-sm font-semibold text-foreground">{t.description}</h4>
                  <span className="tnum shrink-0 text-sm font-semibold text-foreground">
                    {usd(t.amount)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Pill tone={s.tone}>
                    <Icon className="h-3 w-3" />
                    {s.label}
                  </Pill>
                  <span
                    className={cn(
                      "text-xs",
                      overdue ? "font-medium text-danger" : "text-muted",
                    )}
                  >
                    {overdue ? "Deadline missed" : t.released ? "Deadline" : "Due"} {shortDate(t.deadlineMs)}
                  </span>
                </div>
                {proof && (
                  <div className="mt-3">
                    <WalrusDoc doc={proof} />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
