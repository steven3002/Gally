import type { CrankOp } from "@/lib/mock/cranks";
import { Card, CardHeader } from "@/components/ui/primitives";
import { Wrench } from "@/components/ui/icons";
import { CrankButton, CrankMeta } from "./CrankButton";

/**
 * A card listing the permissionless cranks for a subject (asset / token / dispute)
 * or the whole protocol. Each row explains what the crank does, maps to its Move
 * entry, and exposes a runnable trigger (or a gated chip with the reason/unlock).
 * Read-only when no crank applies — the card simply isn't rendered by the caller.
 */
export function CrankPanel({
  ops,
  title = "Maintenance",
  subtitle = "Permissionless keeper calls — anyone may run one once its precondition is met.",
  showSubject = false,
}: {
  ops: CrankOp[];
  title?: string;
  subtitle?: string;
  showSubject?: boolean;
}) {
  if (ops.length === 0) return null;
  return (
    <Card className="p-5">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted" /> {title}
          </span>
        }
        subtitle={subtitle}
        className="px-0 pt-0"
      />
      <ul className="mt-3 divide-y divide-border">
        {ops.map((op) => (
          <li key={`${op.crank}:${op.targetId}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                {op.label}
                {showSubject && <span className="ml-1.5 font-normal text-muted">· {op.targetLabel}</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted">{op.description}</p>
              <CrankMeta op={op} />
            </div>
            <div className="shrink-0">
              <CrankButton op={op} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
