import { notFound } from "next/navigation";
import Link from "next/link";
import {
  assetById,
  assets,
  disputesForAsset,
  validatorForAsset,
} from "@/lib/mock/data";
import { eventsForAsset } from "@/lib/mock/activity";
import {
  bpsToPct,
  daysLeft,
  num,
  pct,
  pctOf,
  relTime,
  shortDate,
  suiscanUrl,
  usd,
  usdCompact,
} from "@/lib/format";
import {
  Avatar,
  Card,
  CardHeader,
  CategoryBadge,
  ProgressBar,
  Stat,
} from "@/components/ui/primitives";
import { Bar, KV, Pill, StatePill } from "@/components/ui/bits";
import { AreaChart, RingGauge } from "@/components/ui/charts";
import { Tabs } from "@/components/ui/Tabs";
import { IdLink } from "@/components/ui/IdLink";
import { WatchButton } from "@/components/WatchButton";
import { StageStepper, LifecycleTimeline } from "@/components/asset/Lifecycle";
import { TrancheList } from "@/components/asset/TrancheList";
import { EventList } from "@/components/events/EventList";
import { DisputeCard } from "@/components/dispute/DisputeCard";
import {
  Alert,
  ChevronRight,
  Coins,
  ExternalLink,
  Lock,
  MapPin,
  Shield,
  Users,
} from "@/components/ui/icons";

export function generateStaticParams() {
  return assets.map((a) => ({ id: a.id }));
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = assetById[id];
  if (!asset) notFound();

  const validator = validatorForAsset(asset);
  const events = eventsForAsset(asset.id);
  const disputes = disputesForAsset(asset.id);
  const acc = asset.accumulator;
  const progress = pctOf(asset.raised, asset.fundingGoal);
  const funding = asset.state === "FUNDING";
  const operational = asset.state === "OPERATIONAL";
  const coverageLocked = asset.coverageLocked;
  const releasedTranches = asset.tranches.filter((t) => t.released).length;
  const wrapRatio = acc && acc.totalMintedShares ? (acc.totalWrappedShares / acc.totalMintedShares) * 100 : 0;

  /* ----------------------------------------------------------- panels */

  const overview = (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-muted">{asset.blurb}</p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h4 className="mb-1 text-sm font-semibold text-foreground">Project details</h4>
          <Bar>
            <KV label="Entity">{asset.entityName}</KV>
            <KV label="Category">{asset.category}</KV>
            <KV label="Location">{asset.location}</KV>
            <KV label="Funding goal">{usd(asset.fundingGoal)}</KV>
            <KV label="Investor revenue split">{bpsToPct(asset.revenueSplitBps)}</KV>
            <KV label="Entity collateral">{usd(asset.entityCollateral)}</KV>
            {asset.isTermFinancing && <KV label="Return target">{usd(asset.returnTarget)}</KV>}
            <KV label="Created">{shortDate(asset.createdAtMs)}</KV>
          </Bar>
        </Card>
        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-foreground">Lifecycle</h4>
          <LifecycleTimeline events={events} />
        </Card>
      </div>
    </div>
  );

  const tranchesPanel = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <TrancheList asset={asset} />
      </div>
      <Card className="h-fit p-5">
        <h4 className="mb-1 text-sm font-semibold text-foreground">Tranche engine</h4>
        <p className="mb-3 text-xs text-muted">
          Capital is released sequentially, each gated by a validator-approved milestone proof.
        </p>
        <Bar>
          <KV label="Tranches released">
            {releasedTranches} / {asset.tranches.length}
          </KV>
          <KV label="Capital deployed">
            {usd(asset.tranches.filter((t) => t.released).reduce((s, t) => s + t.amount, 0))}
          </KV>
          <KV label="Held in escrow">
            {usd(asset.tranches.filter((t) => !t.released).reduce((s, t) => s + t.amount, 0))}
          </KV>
          <KV label="Vouching validator">{validator?.name ?? "—"}</KV>
        </Bar>
      </Card>
    </div>
  );

  const yieldPanel = acc ? (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Cumulative yield index" subtitle="USDC distributed per share (lazy index)" className="px-0 pt-0" />
          <div className="mt-3">
            <AreaChart data={asset.indexSeries} color="var(--positive)" height={200} />
          </div>
        </Card>
        <Card className="p-5">
          <CardHeader title="Wrapped supply" subtitle={`${acc.tokenSymbol} circulating as Coin<T>`} className="px-0 pt-0" />
          <div className="mt-3">
            <AreaChart data={asset.wrapSeries} color="var(--primary)" height={200} />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Revenue & distribution events" />
        <div className="mt-2">
          <EventList
            events={events.filter((e) => e.feed === "revenue" || e.type === "YieldClaimed")}
            showAsset={false}
            emptyHint="No revenue deposited yet."
          />
        </div>
      </Card>
    </div>
  ) : (
    <Card className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <Coins className="h-8 w-8 text-muted-2" />
      <p className="text-sm font-medium text-foreground">No yield yet</p>
      <p className="max-w-sm text-xs text-muted">
        Yield distribution begins once the asset is operational and the entity deposits revenue.
      </p>
    </Card>
  );

  const activityPanel = (
    <Card>
      <EventList events={events} showAsset={false} />
    </Card>
  );

  const tabs = [
    { id: "overview", label: "Overview", content: overview },
    { id: "tranches", label: "Tranches", count: asset.tranches.length, content: tranchesPanel },
    { id: "yield", label: "Yield & revenue", content: yieldPanel },
    { id: "activity", label: "Activity", count: events.length, content: activityPanel },
    ...(disputes.length > 0
      ? [
          {
            id: "disputes",
            label: "Disputes",
            count: disputes.length,
            content: (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {disputes.map((d) => (
                  <DisputeCard key={d.id} dispute={d} />
                ))}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href="/assets" className="hover:text-foreground">Assets</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">{asset.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Avatar seed={asset.id} label={asset.ticker} size={56} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{asset.name}</h1>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-medium text-muted">
                {asset.ticker}
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
              {asset.entityName}
              <span className="text-muted-2">·</span>
              <MapPin className="h-3.5 w-3.5" />
              {asset.location}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatePill state={asset.state} />
              <CategoryBadge category={asset.category} />
              {asset.isTermFinancing && <Pill tone="warning">Term financing</Pill>}
              {asset.disputed && <Pill tone="danger" dot>Disputed</Pill>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-border bg-surface p-1">
            <WatchButton assetId={asset.id} size="h-5 w-5" />
          </div>
          <a
            href={suiscanUrl(asset.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" /> View on Sui
          </a>
          {funding && (
            <button className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-strong">
              <Coins className="h-4 w-4" /> Contribute
            </button>
          )}
        </div>
      </div>

      {/* Stepper */}
      <Card className="p-4">
        <StageStepper asset={asset} />
      </Card>

      {/* Disputed banner */}
      {asset.disputed && (
        <Card className="border-danger/30">
          <div className="flex items-start gap-3 bg-danger-soft p-4">
            <Alert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">This asset has an open dispute.</p>
              <p className="mt-0.5 text-muted">
                Tranche releases are frozen while the validator&apos;s attestation is contested. If
                upheld, slashed stake sweeps into the compensation pool after a grace window —
                wrapped holders should unwrap to remain eligible.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {operational ? (
          <>
            <Card className="p-5">
              <Stat label="Effective APY" value={pct(acc!.apy)} icon={<Coins className="h-4 w-4" />} sub="trailing" />
            </Card>
            <Card className="p-5">
              <Stat label="Yield distributed" value={usdCompact(acc!.lifetimeInvestorRevenue)} sub="lifetime to holders" />
            </Card>
            <Card className="p-5">
              <Stat label="Reward pool" value={usdCompact(acc!.rewardPool)} sub="backs unclaimed yield" />
            </Card>
            <Card className="p-5">
              <Stat label="Holders" value={num(asset.holders)} icon={<Users className="h-4 w-4" />} sub={`${num(asset.fundingGoal)} shares`} />
            </Card>
          </>
        ) : (
          <>
            <Card className="p-5">
              <Stat label="Funding goal" value={usdCompact(asset.fundingGoal)} sub="= total share supply" />
            </Card>
            <Card className="p-5">
              <Stat
                label="Raised"
                value={usdCompact(asset.raised)}
                delta={pct(progress, 0)}
                deltaTone={progress >= 100 ? "positive" : "muted"}
                sub={funding ? `${daysLeft(asset.fundingDeadlineMs)} days left` : `${num(asset.contributors)} contributors`}
              />
            </Card>
            <Card className="p-5">
              <Stat label="Entity collateral" value={usdCompact(asset.entityCollateral)} icon={<Lock className="h-4 w-4" />} sub="slashable skin-in-the-game" />
            </Card>
            <Card className="p-5">
              <Stat label="Revenue split" value={bpsToPct(asset.revenueSplitBps)} sub="to investors" />
            </Card>
          </>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          {/* Primary chart */}
          <Card className="p-5">
            {funding ? (
              <>
                <CardHeader title="Raise progress" subtitle="Cumulative capital contributed" className="px-0 pt-0" />
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <div className="tnum text-3xl font-bold tracking-tight text-foreground">
                      {usd(asset.raised)}
                    </div>
                    <div className="mt-1 text-sm text-muted">of {usd(asset.fundingGoal)} goal</div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-2xl font-semibold text-primary">{pct(progress, 0)}</div>
                    <div className="text-xs text-muted">{daysLeft(asset.fundingDeadlineMs)} days left</div>
                  </div>
                </div>
                <div className="mt-3">
                  <ProgressBar value={progress} tone="primary" height="h-2.5" />
                </div>
                <div className="mt-5">
                  <AreaChart data={asset.raiseSeries} color="var(--primary)" height={180} />
                </div>
              </>
            ) : operational ? (
              <>
                <CardHeader title="Yield index" subtitle="Cumulative USDC distributed per share" className="px-0 pt-0" />
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <div className="tnum text-3xl font-bold tracking-tight text-positive">
                      {pct(acc!.apy)}
                    </div>
                    <div className="mt-1 text-sm text-muted">effective APY · {usd(acc!.lifetimeInvestorRevenue)} distributed</div>
                  </div>
                </div>
                <div className="mt-5">
                  <AreaChart data={asset.indexSeries} color="var(--positive)" height={200} />
                </div>
              </>
            ) : (
              <>
                <CardHeader title="Capital formation" subtitle="Raise history" className="px-0 pt-0" />
                <div className="mt-4">
                  <AreaChart data={asset.raiseSeries} color="var(--muted-2)" height={200} />
                </div>
              </>
            )}
          </Card>

          {/* Tabs */}
          <Card className="p-5">
            <Tabs tabs={tabs} />
          </Card>
        </div>

        {/* Side */}
        <div className="space-y-6 xl:col-span-4">
          {/* Validator */}
          {validator && (
            <Card className="p-5">
              <CardHeader title="Validator attestation" className="px-0 pt-0" />
              <Link
                href={`/validators/${validator.poolId}`}
                className="mt-3 flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-border-strong"
              >
                <Avatar seed={validator.poolId} label={validator.name} size={40} rounded="rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{validator.name}</div>
                  <div className="text-xs text-muted">
                    {validator.status === "ACTIVE" ? "Active validator" : validator.status}
                  </div>
                </div>
                <RingGauge value={validator.reputation} size={44} thickness={5} color="var(--positive)" label={<span className="tnum text-[10px]">{validator.reputation}</span>} />
              </Link>
              <div className="mt-3">
                <Bar>
                  <KV label="Coverage locked">{usd(coverageLocked)}</KV>
                  <KV label="Total stake">{usd(validator.stake)}</KV>
                  <KV label="Track record">{validator.milestonesApproved} approvals</KV>
                </Bar>
              </div>
            </Card>
          )}

          {/* Accumulator / token */}
          {acc && (
            <Card className="p-5">
              <CardHeader title="Yield accumulator" subtitle={`Token ${acc.tokenSymbol} · 6 decimals`} className="px-0 pt-0" />
              <div className="mt-3 flex items-center justify-between">
                <Stat label="Wrap ratio" value={pct(wrapRatio, 0)} sub="of supply wrapped" />
                <RingGauge value={wrapRatio} size={64} thickness={7} label={<span className="tnum text-xs font-semibold">{pct(wrapRatio, 0)}</span>} />
              </div>
              <div className="mt-2">
                <Bar>
                  <KV label="Total shares">{num(acc.totalMintedShares)}</KV>
                  <KV label="Wrapped">{num(acc.totalWrappedShares)} {acc.tokenSymbol}</KV>
                  <KV label="Reward pool">{usd(acc.rewardPool)}</KV>
                  {acc.rolloverReserve > 0 && <KV label="Rollover reserve">{usd(acc.rolloverReserve)}</KV>}
                  {acc.compensationPool > 0 && (
                    <KV label="Compensation pool">
                      <span className="text-danger">{usd(acc.compensationPool)}</span>
                    </KV>
                  )}
                </Bar>
              </div>
              {acc.wrappingFrozen && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                  <Lock className="h-3.5 w-3.5" /> Wrapping frozen — compensation grace window active
                </div>
              )}
            </Card>
          )}

          {/* On-chain refs */}
          <Card className="p-5">
            <CardHeader title="On-chain references" className="px-0 pt-0" />
            <div className="mt-3 flex flex-col gap-2">
              <RefRow label="Asset object" value={asset.id} />
              <RefRow label="Entity" value={asset.entity} />
              {acc && <RefRow label="Accumulator" value={acc.id} />}
              {validator && <RefRow label="Validator pool" value={validator.poolId} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted">{label}</span>
      <IdLink id={value} />
    </div>
  );
}
