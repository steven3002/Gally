import type { Solvency } from "@/lib/mock/health";
import { num, usd } from "@/lib/format";
import { Pill } from "@/components/ui/primitives";
import { Shield } from "@/components/ui/icons";

/**
 * Solvency indicator (FE-M5, §15.4 / I-M2). `health = reward_pool / owed`; the
 * protocol guarantees `reward_pool ≥ owed` (the gap is truncation dust that
 * favors the pool), so a sound asset reads "Healthy" with a ≥ 1× coverage ratio.
 * The badge flips to "At risk" only if the invariant were ever violated.
 */
export function SolvencyBadge({ solvency }: { solvency: Solvency }) {
  const tone = solvency.healthy ? "positive" : "danger";
  const ratio = solvency.owed > 0 && Number.isFinite(solvency.ratio) ? `${solvency.ratio.toFixed(2)}×` : null;
  return (
    <Pill tone={tone} dot={solvency.healthy}>
      <Shield className="h-3 w-3" />
      {solvency.healthy ? "Healthy" : "At risk"}
      {ratio && <span className="text-muted-2">· {ratio} backed</span>}
    </Pill>
  );
}

/** Fuller solvency readout for the accumulator/token card — pool vs. owed + the honest buffer note. */
export function SolvencyMeter({ solvency }: { solvency: Solvency }) {
  const ratio = solvency.owed > 0 && Number.isFinite(solvency.ratio) ? solvency.ratio : null;
  const fill = ratio ? Math.min(100, (solvency.owed / solvency.rewardPool) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Reward-pool solvency</span>
        <SolvencyBadge solvency={solvency} />
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3">
        {/* owed (claimed against the pool) vs. the buffer that backs it */}
        <div className="h-full rounded-full bg-positive" style={{ width: `${Math.max(2, fill)}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-2">
        <span>{usd(solvency.owed)} owed</span>
        <span>{usd(solvency.rewardPool)} reward pool</span>
      </div>
      <p className="mt-2 text-[11px] text-muted-2">
        {solvency.hasYield
          ? `Buffer ${usd(solvency.buffer)} — the §15.4 truncation dust that keeps the pool solvent (I-M2). 1 share = 1 USDC.`
          : "No yield distributed yet, so nothing is owed against the pool."}
      </p>
      {solvency.owed > 0 && (
        <p className="mt-1 text-[11px] text-muted-2">
          Across {num(solvency.owed)} USDC of unclaimed lazy-index entitlements.
        </p>
      )}
    </div>
  );
}
