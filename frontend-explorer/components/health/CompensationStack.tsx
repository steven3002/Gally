import type { CompensationStack as Stack } from "@/lib/mock/health";
import { usd } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/primitives";
import { Shield } from "@/components/ui/icons";

/**
 * The three-layer restitution stack (FE-M5, §13/§14 Triangle of Repercussion):
 * on default/upheld dispute, holders are made whole in order — undeployed escrow
 * → slashed validator coverage → entity collateral — all swept into the
 * compensation pool, then distributed pro-rata via the lazy index.
 */
export function CompensationStack({ stack }: { stack: Stack }) {
  return (
    <Card className="p-5">
      <CardHeader
        title="Compensation stack"
        subtitle="Three restitution layers, seized in order (§13)"
        className="px-0 pt-0"
      />
      <ol className="mt-4 space-y-3">
        {stack.layers.map((l, i) => (
          <li key={l.label} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-semibold text-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">{l.label}</span>
                <span className="tnum shrink-0 text-sm font-semibold text-foreground">{usd(l.amount)}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted">{l.note}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-danger">
          <Shield className="h-4 w-4" /> Compensation pool
        </div>
        <span className="tnum text-sm font-semibold text-danger">{usd(stack.pool)}</span>
      </div>
      <p className="mt-2 text-[11px] text-muted-2">
        The pool is distributed pro-rata to holders through the index on sweep — no push loop,
        no snapshot. Wrapped holders must unwrap before the grace deadline to be eligible (D5).
      </p>
    </Card>
  );
}
