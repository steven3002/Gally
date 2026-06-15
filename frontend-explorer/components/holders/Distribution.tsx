import type { RankedHolder } from "@/lib/mock/holders";
import { accountLabel } from "@/lib/mock/accounts";
import { num, pct, shortAddr } from "@/lib/format";
import { Donut } from "@/components/ui/charts";

/** Distinct hues for the top holders in the concentration donut (brand green first). */
const PALETTE = ["#5e7e2a", "#4593e6", "#e89110", "#0fb39a", "#e5484d"];
const OTHERS = "#8b8f9e";

/**
 * Holder concentration + supply summary for one asset (FE-M3). Donut of the
 * top-5 holders vs. the long tail, the top-1 / top-10 concentration, and the
 * minted / wrapped / unwrapped split (Σ deeds + Σ wrapped == minted, MI-1).
 */
export function Distribution({
  holders,
  supply,
  tokenSymbol,
}: {
  holders: RankedHolder[];
  supply: { minted: number; wrapped: number; unwrapped: number };
  tokenSymbol?: string;
}) {
  const top = holders.slice(0, 5);
  const othersPct = holders.slice(5).reduce((s, h) => s + h.pctOfSupply, 0);
  const segments = top.map((h, i) => ({ value: h.pctOfSupply, color: PALETTE[i % PALETTE.length] }));
  if (othersPct > 0.0001) segments.push({ value: othersPct, color: OTHERS });

  const top1 = holders[0]?.pctOfSupply ?? 0;
  const top10 = holders.slice(0, 10).reduce((s, h) => s + h.pctOfSupply, 0);
  const wrapRatio = supply.minted ? (supply.wrapped / supply.minted) * 100 : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Concentration donut */}
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <Donut
          segments={segments}
          size={150}
          thickness={18}
          center={
            <div className="text-center">
              <div className="tnum text-lg font-bold text-foreground">{num(holders.length)}</div>
              <div className="text-[10px] text-muted">holders</div>
            </div>
          }
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          {top.map((h, i) => (
            <div key={h.address} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate text-muted">{accountLabel(h.address) ?? shortAddr(h.address, 8, 4)}</span>
              <span className="tnum ml-auto font-medium text-foreground">{pct(h.pctOfSupply, 1)}</span>
            </div>
          ))}
          {othersPct > 0.0001 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: OTHERS }} />
              <span className="truncate text-muted">Others ({num(Math.max(0, holders.length - 5))})</span>
              <span className="tnum ml-auto font-medium text-foreground">{pct(othersPct, 1)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Supply + concentration metrics */}
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Total supply" value={num(supply.minted)} sub="shares minted = goal" />
        <Metric
          label="Wrapped"
          value={num(supply.wrapped)}
          sub={`${pct(wrapRatio, 0)} as ${tokenSymbol ?? "Coin<T>"}`}
        />
        <Metric label="Unwrapped deeds" value={num(supply.unwrapped)} sub="yield-bearing" />
        <Metric label="Top holder" value={pct(top1, 1)} sub={`top 10 hold ${pct(top10, 0)}`} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="text-[11px] text-muted-2">{label}</div>
      <div className="tnum mt-0.5 text-base font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted">{sub}</div>
    </div>
  );
}
