import { PageHeader } from "@/components/PageHeader";
import { Card, Stat } from "@/components/ui/primitives";
import { Paginated } from "@/components/ui/Pager";
import { ValidatorCard } from "@/components/validator/ValidatorCard";
import { data } from "@/lib/data";
import { usdCompact, usd } from "@/lib/format";
import { Shield, Lock, Coins } from "@/components/ui/icons";

export default async function ValidatorsPage() {
  const base = await data.listValidators();
  // The list endpoint omits reputation + track-record (detail-only), so the cards and
  // "Avg reputation" would read 0 while each validator's detail page shows the real score.
  // Enrich each from its detail (bounded by the small validator set) so the numbers agree.
  const validators = await Promise.all(base.map((v) => data.getValidator(v.poolId).then((d) => d ?? v)));
  // Live ProtocolConfig (object-proxy) — the real on-chain min-stake / coverage, not a mock.
  const cfg = await data.getProtocolConfig();
  const sorted = [...validators].sort((a, b) => b.stake - a.stake);
  const totalStake = validators.reduce((s, v) => s + v.stake, 0);
  const totalLocked = validators.reduce((s, v) => s + v.locked, 0);
  const active = validators.filter((v) => v.status === "ACTIVE").length;
  const avgRep = Math.round(
    validators.reduce((s, v) => s + v.reputation, 0) / Math.max(1, validators.length),
  );

  return (
    <div>
      <PageHeader
        title="Validators"
        subtitle="Stake-backed attestors who vouch project legals, approve milestones and serve on dispute juries."
        crumbs={[{ label: "Explore", href: "/" }, { label: "Validators" }]}
      />

      <div data-tour="val-stats" className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Total stake" value={usdCompact(totalStake)} icon={<Coins className="h-4 w-4" />} sub="slashable USDC collateral" />
        </Card>
        <Card className="p-5">
          <Stat label="Committed" value={usdCompact(totalLocked)} icon={<Lock className="h-4 w-4" />} sub="locked against vouches" />
        </Card>
        <Card className="p-5">
          <Stat label="Active validators" value={String(active)} icon={<Shield className="h-4 w-4" />} sub={`of ${validators.length} pools`} />
        </Card>
        <Card className="p-5">
          <Stat label="Avg reputation" value={String(avgRep)} sub="0–100 track-record score" />
        </Card>
      </div>

      <div data-tour="val-min" className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
        <Lock className="h-4 w-4 shrink-0 text-muted-2" />
        Minimum validator stake is{" "}
        <span className="font-semibold text-foreground">{usd(cfg.minValidatorStake)}</span>; each vouch
        locks {cfg.vouchCoverageBps / 100}% of the asset&apos;s funding goal as coverage.
      </div>

      <div data-tour="val-list">
        <Paginated pageSize={12} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((v) => (
            <ValidatorCard key={v.poolId} validator={v} />
          ))}
        </Paginated>
      </div>
    </div>
  );
}
