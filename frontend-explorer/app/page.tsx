import Link from "next/link";
import {
  assets,
  categoryStats,
  disputes,
  protocolStats,
} from "@/lib/mock/data";
import { recentEvents } from "@/lib/mock/activity";
import { pct, usdCompact } from "@/lib/format";
import { Card, CardHeader, SectionHeader, Stat } from "@/components/ui/primitives";
import { CategoryIcon } from "@/components/ui/primitives";
import { Sparkline } from "@/components/ui/charts";
import { AssetCard } from "@/components/asset/AssetCard";
import { AssetTable } from "@/components/asset/AssetTable";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { EventList } from "@/components/events/EventList";
import {
  ArrowRight,
  Coins,
  Gauge,
  Layers,
  Scale,
  TrendUp,
  Users,
} from "@/components/ui/icons";

export default function ExplorePage() {
  const trending = [...assets]
    .filter((a) => a.state === "OPERATIONAL" || a.state === "FUNDING")
    .sort((a, b) => (b.accumulator?.apy ?? 0) - (a.accumulator?.apy ?? 0))
    .slice(0, 3);

  const topAssets = [...assets].sort((a, b) => b.raised - a.raised).slice(0, 6);
  const sectors = categoryStats().sort((a, b) => b.raised - a.raised);
  const openDisputes = disputes.filter((d) => d.status === "OPEN");

  return (
    <div className="space-y-7">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[var(--radius-card)] bg-brand-gradient p-6 text-white shadow-[var(--shadow-md)] sm:p-8">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
              <span className="h-1.5 w-1.5 animate-livedot rounded-full bg-white" />
              Capital Explorer
            </span>
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Real-world assets,
              <br />
              transparently funded.
            </h1>
            <p className="mt-3 max-w-md text-sm text-white/80">
              Track every USDC raise, validator attestation, tranche release and yield
              distribution across the Gally protocol — reconstructed entirely from on-chain events.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/assets"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#1c2226] transition-transform hover:scale-[1.02]"
              >
                Browse assets <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/portfolio"
                className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                View portfolio
              </Link>
            </div>
          </div>

          {/* TVL float card */}
          <div className="w-full max-w-xs rounded-2xl bg-white/12 p-5 backdrop-blur-md ring-1 ring-white/20">
            <div className="text-xs font-medium text-white/70">Total value locked</div>
            <div className="tnum mt-1 text-3xl font-bold tracking-tight">
              {usdCompact(protocolStats.tvl)}
            </div>
            <div className="mt-1 text-xs text-white/70">
              across {protocolStats.activeAssets} active assets
            </div>
            <div className="-mx-1 mt-3">
              <Sparkline
                data={protocolStats.tvlSpark}
                color="#ffffff"
                width={260}
                height={48}
                className="w-full"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/15 pt-3 text-xs">
              <div>
                <div className="text-white/60">In funding</div>
                <div className="tnum font-semibold">{usdCompact(protocolStats.fundingRaisedOpen)}</div>
              </div>
              <div>
                <div className="text-white/60">Avg APY</div>
                <div className="tnum font-semibold">{pct(protocolStats.avgApy)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat
            label="Total Value Locked (TVL)"
            value={usdCompact(protocolStats.totalRaised)}
            delta="+8.2%"
            deltaTone="positive"
            icon={<Coins className="h-4 w-4" />}
            sub={`${protocolStats.contributors.toLocaleString()} investors`}
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Yield distributed"
            value={usdCompact(protocolStats.totalYieldDistributed)}
            delta="+3.1%"
            deltaTone="positive"
            icon={<TrendUp className="h-4 w-4" />}
            sub="to deed holders, lifetime"
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Avg effective APY"
            value={pct(protocolStats.avgApy)}
            icon={<Gauge className="h-4 w-4" />}
            sub="operational assets"
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Validator stake"
            value={usdCompact(protocolStats.totalValidatorStake)}
            icon={<Users className="h-4 w-4" />}
            sub={`${protocolStats.validators} active validators`}
          />
        </Card>
      </section>

      {/* Main + rail */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Main */}
        <div className="space-y-7 xl:col-span-8">
          <section>
            <SectionHeader
              title="Trending assets"
              subtitle="Highest-yielding and actively raising projects"
              href="/assets"
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {trending.map((a) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Browse by sector" subtitle="Real-world asset categories" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sectors.map((s) => (
                <Link
                  key={s.category}
                  href={`/assets?category=${encodeURIComponent(s.category)}`}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-sm)]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted group-hover:bg-primary-soft group-hover:text-primary">
                    <CategoryIcon category={s.category} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {s.category}
                    </div>
                    <div className="tnum text-xs text-muted">
                      {s.count} {s.count === 1 ? "asset" : "assets"} · {usdCompact(s.raised)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <Card>
              <CardHeader
                title="Top assets by capital raised"
                action={
                  <Link
                    href="/assets"
                    className="text-xs font-semibold text-primary hover:text-primary-strong"
                  >
                    See all {assets.length}
                  </Link>
                }
              />
              <div className="mt-3">
                <AssetTable assets={topAssets} />
              </div>
            </Card>
          </section>
        </div>

        {/* Rail */}
        <div className="space-y-6 xl:col-span-4">
          {openDisputes.length > 0 && (
            <Card className="overflow-hidden border-danger/30">
              <div className="flex items-start gap-3 bg-danger-soft p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger/15 text-danger">
                  <Scale className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {openDisputes.length} open dispute{openDisputes.length > 1 ? "s" : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Validator attestations are being contested. Wrapped holders should review the
                    compensation window.
                  </p>
                  <Link
                    href="/disputes"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-danger hover:underline"
                  >
                    Review disputes <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Watchlist"
              subtitle="Saved in your browser"
              action={<Layers className="h-4 w-4 text-muted-2" />}
            />
            <div className="mt-2">
              <WatchlistPanel />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Live activity"
              action={
                <Link
                  href="/activity"
                  className="text-xs font-semibold text-primary hover:text-primary-strong"
                >
                  View feed
                </Link>
              }
            />
            <div className="mt-2">
              <EventList events={recentEvents(6)} limit={6} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
