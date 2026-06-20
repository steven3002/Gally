import { notFound } from "next/navigation";
import Link from "next/link";
import { assets, DEMO_WALLET } from "@/lib/mock/data";
import { data, isLive } from "@/lib/data";
import { graceOf } from "@/lib/mock/health";
import { num, pct, apyPct, suiscanUrl, usd } from "@/lib/format";
import { Avatar, Card, CardHeader, Stat } from "@/components/ui/primitives";
import { Bar, KV, Pill, StatePill } from "@/components/ui/bits";
import { AreaChart, RingGauge } from "@/components/ui/charts";
import { Tabs } from "@/components/ui/Tabs";
import { IdLink } from "@/components/ui/IdLink";
import { Distribution } from "@/components/holders/Distribution";
import { HolderTable } from "@/components/holders/HolderTable";
import { EventList } from "@/components/events/EventList";
import { SolvencyMeter } from "@/components/health/SolvencyBadge";
import { GraceCountdown } from "@/components/health/GraceCountdown";
import { CrankPanel } from "@/components/tx/CrankPanel";
import { cranksForAccumulator } from "@/lib/mock/cranks";
import { ChevronRight, Coins, ExternalLink, Lock } from "@/components/ui/icons";

export function generateStaticParams() {
  if (isLive) return []; // live: render on demand from the indexer
  return assets.filter((a) => a.accumulator).map((a) => ({ accId: a.accumulator!.id }));
}

export default async function TokenPage({ params }: { params: Promise<{ accId: string }> }) {
  const { accId } = await params;
  const asset = await data.getAssetByAccId(accId);
  if (!asset || !asset.accumulator) notFound();

  const acc = asset.accumulator;
  const mintedShares = acc.totalMintedShares ?? asset.fundingGoal ?? 0;
  const wrappedShares = acc.totalWrappedShares ?? 0;
  const supply = { minted: mintedShares, wrapped: wrappedShares, unwrapped: mintedShares - wrappedShares };
  const [holders, events, solvency] = await Promise.all([
    data.holderDistribution(asset.id),
    data.eventsForAsset(asset.id, 100),
    data.getSolvency(asset.id),
  ]);
  const grace = graceOf(asset);
  const wrapRatio = acc.totalMintedShares ? (acc.totalWrappedShares / acc.totalMintedShares) * 100 : 0;
  const closed = asset.state === "CLOSED";
  const cranks = cranksForAccumulator(asset);

  const holdersPanel =
    holders.length > 0 ? (
      <div className="space-y-6">
        <Card className="p-5">
          <CardHeader title="Distribution" subtitle="Holder concentration & supply breakdown" className="px-0 pt-0" />
          <div className="mt-4">
            <Distribution holders={holders} supply={supply} tokenSymbol={acc.tokenSymbol} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Holder ledger" subtitle="Deeds (yield-bearing) + wrapped Coin<T>" />
          <div className="mt-2">
            <HolderTable holders={holders} tokenSymbol={acc.tokenSymbol} demoAddress={DEMO_WALLET} pageSize={20} />
          </div>
        </Card>
      </div>
    ) : (
      <Card className="p-8 text-center text-sm text-muted">No holders yet for this token.</Card>
    );

  const activityPanel = (
    <Card>
      <EventList
        events={events.filter((e) => e.feed === "revenue" || e.feed === "position")}
        showAsset={false}
        pageSize={20}
        emptyHint="No wrap/unwrap or revenue activity yet."
      />
    </Card>
  );

  const tabs = [
    { id: "holders", label: "Holders", count: holders.length, content: holdersPanel },
    { id: "activity", label: "Token activity", content: activityPanel },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href="/assets" className="hover:text-foreground">Assets</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href={`/assets/${asset.id}`} className="hover:text-foreground">{asset.name}</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">{acc.tokenSymbol}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Avatar seed={acc.id} label={acc.tokenSymbol} size={56} rounded="rounded-full" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{acc.tokenSymbol}</h1>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-medium text-muted">
                6 decimals
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              GlobalYieldAccumulator&lt;T&gt; for{" "}
              <Link href={`/assets/${asset.id}`} className="font-medium text-muted transition-colors hover:text-primary hover:underline">
                {asset.name}
              </Link>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatePill state={asset.state} />
              {acc.wrappingFrozen && <Pill tone="warning" dot>Wrapping frozen</Pill>}
              {closed && <Pill tone="neutral">Closed</Pill>}
              <Pill tone="info">1 {acc.tokenSymbol} = 1 USDC</Pill>
            </div>
          </div>
        </div>
        <a
          href={suiscanUrl(acc.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" /> View on Sui
        </a>
      </div>

      {/* Supply summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Total supply" value={num(supply.minted)} icon={<Coins className="h-4 w-4" />} sub="shares minted = goal" />
        </Card>
        <Card className="p-5">
          <Stat label="Wrapped" value={num(supply.wrapped)} icon={<Lock className="h-4 w-4" />} sub={`${pct(wrapRatio, 0)} as ${acc.tokenSymbol}`} />
        </Card>
        <Card className="p-5">
          <Stat label="Unwrapped deeds" value={num(supply.unwrapped)} sub="yield-bearing" />
        </Card>
        <Card className="p-5">
          <Stat
            label="Cumulative index"
            value={acc.cumulativeIndex.toFixed(4)}
            sub={acc.apy > 0 ? `${apyPct(acc.apy)} effective APY` : "USDC/share, lifetime"}
            deltaTone="positive"
          />
        </Card>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <CardHeader title="Cumulative yield index" subtitle="USDC distributed per share (lazy index)" className="px-0 pt-0" />
              <div className="mt-3">
                <AreaChart data={asset.indexSeries} color="var(--positive)" height={190} />
              </div>
            </Card>
            <Card className="p-5">
              <CardHeader title="Wrapped supply" subtitle={`${acc.tokenSymbol} circulating as Coin<T>`} className="px-0 pt-0" />
              <div className="mt-3">
                <AreaChart data={asset.wrapSeries} color="var(--primary)" height={190} />
              </div>
            </Card>
          </div>
          <Card className="p-5">
            <Tabs tabs={tabs} />
          </Card>
        </div>

        {/* Side */}
        <div className="space-y-6 xl:col-span-4">
          <Card className="p-5">
            <CardHeader title="Wrap ratio" subtitle="Share of supply held as Coin<T>" className="px-0 pt-0" />
            <div className="mt-3 flex items-center justify-between">
              <Stat label="Wrapped" value={pct(wrapRatio, 1)} sub={`${num(supply.wrapped)} / ${num(supply.minted)}`} />
              <RingGauge value={wrapRatio} size={72} thickness={8} label={<span className="tnum text-xs font-semibold">{pct(wrapRatio, 0)}</span>} />
            </div>
            <p className="mt-3 text-[11px] text-muted-2">
              Wrapped tokens earn no yield while wrapped — the index denominator is unwrapped
              supply only, so unwrapped holders earn the wrapped holders&apos; share.
            </p>
          </Card>

          {/* Pools + solvency */}
          <Card className="p-5">
            <CardHeader title="Accumulator pools" className="px-0 pt-0" />
            <div className="mt-2">
              <Bar>
                <KV label="Reward pool">{usd(acc.rewardPool)}</KV>
                <KV label="Rollover reserve">{usd(acc.rolloverReserve)}</KV>
                <KV label="Compensation pool">
                  <span className={acc.compensationPool > 0 ? "text-danger" : undefined}>{usd(acc.compensationPool)}</span>
                </KV>
                <KV label="Lifetime investor revenue">{usd(acc.lifetimeInvestorRevenue)}</KV>
              </Bar>
            </div>
            {solvency.hasYield && (
              <div className="mt-3">
                <SolvencyMeter solvency={solvency} />
              </div>
            )}
            {grace && (
              <div className="mt-3">
                <GraceCountdown grace={grace} tokenSymbol={acc.tokenSymbol} />
              </div>
            )}
          </Card>

          {/* Permissionless cranks (keeper maintenance) */}
          {cranks.length > 0 && <CrankPanel ops={cranks} />}

          {/* On-chain refs */}
          <Card className="p-5">
            <CardHeader title="On-chain references" className="px-0 pt-0" />
            <div className="mt-3 flex flex-col gap-2">
              <RefRow label="Accumulator" value={acc.id} />
              <RefRow label="Asset object" value={asset.id} />
              <RefRow label="Entity" value={asset.entity} />
            </div>
            <p className="mt-3 text-[11px] text-muted-2">
              The <code>TreasuryCap&lt;{acc.tokenSymbol}&gt;</code> is custodied inside the accumulator
              forever — only the wrap machine can mint/burn, so supply always equals wrapped shares.
            </p>
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
