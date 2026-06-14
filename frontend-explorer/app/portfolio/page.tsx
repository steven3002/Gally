import Link from "next/link";
import type { Category } from "@/lib/types";
import {
  DEMO_WALLET,
  portfolio,
  portfolioReceipts,
} from "@/lib/mock/data";
import { portfolioActivity } from "@/lib/mock/activity";
import { num, pct, usd, usdCompact } from "@/lib/format";
import {
  Avatar,
  Card,
  CardHeader,
  SectionHeader,
} from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/bits";
import { AddressChip } from "@/components/ui/AddressChip";
import { Donut, Sparkline } from "@/components/ui/charts";
import { EventList } from "@/components/events/EventList";
import { Coins, Wallet, ArrowRight, Lock } from "@/components/ui/icons";

const CATEGORY_COLOR: Record<Category, string> = {
  Housing: "#6c5cf6",
  Energy: "#e5484d",
  "Trade Finance": "#e89110",
  Agriculture: "#0fb39a",
  Machinery: "#4593e6",
  Infrastructure: "#8b8f9e",
};

function normalizedAverage(series: number[][]): number[] {
  const len = Math.min(...series.map((s) => s.length));
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (const s of series) {
      const min = Math.min(...s);
      const max = Math.max(...s);
      acc += (s[i] - min) / (max - min || 1);
    }
    out.push(acc / series.length);
  }
  return out;
}

export default function PortfolioPage() {
  // 1 share == 1 USDC of principal; deeds and wrapped are both valued at par.
  const deedsValue = portfolio.reduce((s, p) => s + p.deeds, 0);
  const wrappedValue = portfolio.reduce((s, p) => s + p.wrapped, 0);
  const principal = deedsValue + wrappedValue;
  const invested = portfolio.reduce((s, p) => s + p.costBasis, 0);
  const totalYield = portfolio.reduce((s, p) => s + p.yieldEarned, 0);
  const totalClaimable = portfolio.reduce((s, p) => s + p.yieldClaimable, 0);
  const lifetimeYieldPct = invested ? (totalYield / invested) * 100 : 0;
  const claimablePositions = portfolio.filter((p) => p.yieldClaimable > 0).length;
  const spark = normalizedAverage(portfolio.map((p) => p.spark));

  const allocation = Object.entries(
    portfolio.reduce<Record<string, number>>((acc, p) => {
      acc[p.category] = (acc[p.category] ?? 0) + p.deeds + p.wrapped;
      return acc;
    }, {}),
  ).map(([category, value]) => ({
    label: category,
    value,
    color: CATEGORY_COLOR[category as Category],
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Avatar seed={DEMO_WALLET} size={48} />
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              Portfolio
              <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">
                Demo wallet
              </span>
            </h1>
            <div className="mt-1">
              <AddressChip address={DEMO_WALLET} lead={10} tail={6} />
            </div>
          </div>
        </div>
      </div>

      {/* Hero + allocation */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="relative overflow-hidden bg-brand-gradient p-6 text-white lg:col-span-2">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs font-medium text-white/70">
              <Wallet className="h-4 w-4" /> Total holdings value
            </div>
            <div className="tnum mt-1 text-4xl font-bold tracking-tight">{usd(principal)}</div>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="text-emerald-200">+{usd(totalYield)} yield earned</span>
              <span className="text-white/60">· {pct(lifetimeYieldPct)} lifetime on {usdCompact(invested)}</span>
            </div>
            <div className="-mx-1 mt-4">
              <Sparkline data={spark} color="#ffffff" width={520} height={56} className="w-full" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/15 pt-4 text-sm sm:grid-cols-4">
              <div>
                <div className="flex items-center gap-1 text-white/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Deeds
                </div>
                <div className="tnum font-semibold">{usd(deedsValue)}</div>
                <div className="text-[11px] text-white/55">yield-bearing</div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-white/60">
                  <Lock className="h-3 w-3" /> Wrapped
                </div>
                <div className="tnum font-semibold">{usd(wrappedValue)}</div>
                <div className="text-[11px] text-white/55">no yield</div>
              </div>
              <div>
                <div className="text-white/60">Yield earned</div>
                <div className="tnum font-semibold">{usd(totalYield)}</div>
                <div className="text-[11px] text-white/55">lifetime</div>
              </div>
              <div>
                <div className="text-white/60">Claimable</div>
                <div className="tnum font-semibold">{usd(totalClaimable)}</div>
                <div className="text-[11px] text-white/55">on deeds</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col p-5">
          <CardHeader title="Allocation" subtitle="By sector (principal)" className="px-0 pt-0" />
          <div className="mt-2 flex flex-1 flex-col items-center justify-center gap-4 sm:flex-row">
            <Donut
              segments={allocation}
              size={150}
              thickness={18}
              center={
                <div className="text-center">
                  <div className="tnum text-lg font-bold text-foreground">{usdCompact(principal)}</div>
                  <div className="text-[10px] text-muted">principal</div>
                </div>
              }
            />
            <div className="space-y-1.5">
              {allocation.map((a) => (
                <div key={a.label} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
                  <span className="text-muted">{a.label}</span>
                  <span className="tnum ml-auto font-medium text-foreground">
                    {pct((a.value / principal) * 100, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Claimable banner */}
      {totalClaimable > 0 && (
        <Card className="flex flex-col items-start justify-between gap-3 border-positive/30 bg-positive-soft/40 p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-positive/15 text-positive">
              <Coins className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">
                {usd(totalClaimable)} in yield ready to claim
              </div>
              <div className="text-xs text-muted">
                Accrued via the lazy index on your GallyShare deeds across {claimablePositions}{" "}
                position{claimablePositions === 1 ? "" : "s"}. Wrapped tokens are not included.
              </div>
            </div>
          </div>
          <button className="inline-flex items-center gap-2 rounded-xl bg-positive px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
            Claim all <ArrowRight className="h-4 w-4" />
          </button>
        </Card>
      )}

      {/* Holdings */}
      <section>
        <SectionHeader title="Holdings" subtitle="Deeds accrue yield; wrapped tokens are composable but earn none until unwrapped" />

        {/* legend */}
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted sm:flex-row sm:items-center sm:gap-6">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-positive" />
            <span className="font-medium text-foreground">Deeds (GallyShare)</span> — owned objects,
            accrue yield, claimable
          </span>
          <span className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-muted-2" />
            <span className="font-medium text-foreground">Wrapped (Coin&lt;T&gt;)</span> — coin
            balance, composable, no yield until unwrapped
          </span>
        </div>

        <Card>
          <div className="divide-y divide-border">
            {portfolio.map((p) => {
              const positionPrincipal = p.deeds + p.wrapped;
              return (
                <div
                  key={p.assetId}
                  className="flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* asset + balances */}
                  <Link href={`/assets/${p.assetId}`} className="flex min-w-0 flex-1 items-start gap-3">
                    <Avatar seed={p.assetId} label={p.ticker} size={40} rounded="rounded-lg" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{p.assetName}</span>
                        <StatePill state={p.state} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-positive-soft px-2 py-1 text-[11px] font-medium text-positive">
                          <Coins className="h-3 w-3" />
                          {num(p.deeds)} deeds · earning
                        </span>
                        {p.wrapped > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-[11px] font-medium text-muted">
                            <Lock className="h-3 w-3" />
                            {num(p.wrapped)} {p.tokenSymbol} · no yield
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-2">fully unwrapped</span>
                        )}
                      </div>
                    </div>
                  </Link>

                  {/* stats */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:items-center sm:gap-8 sm:text-right">
                    <Cell label="Principal" value={usd(positionPrincipal)} sub={`${num(positionPrincipal)} shares`} />
                    <Cell label="Yield earned" value={usd(p.yieldEarned)} sub="lifetime" />
                    <Cell
                      label="Claimable"
                      value={p.yieldClaimable > 0 ? `+${usd(p.yieldClaimable)}` : "—"}
                      valueClass={p.yieldClaimable > 0 ? "text-positive" : "text-muted-2"}
                      sub={p.yieldClaimable > 0 ? `on ${num(p.deeds)} deeds` : "—"}
                    />
                    <Cell label="APY" value={pct(p.apy)} valueClass="text-positive" sub="on deeds" />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Pending receipts */}
      {portfolioReceipts.length > 0 && (
        <section>
          <SectionHeader
            title="Contribution receipts"
            subtitle="Soulbound — convert to GallyShare deeds when the raise finalizes, or refund if it fails. Receipts do not earn yield."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {portfolioReceipts.map((r) => (
              <Card key={r.assetId} className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar seed={r.assetId} size={36} rounded="rounded-lg" />
                  <div>
                    <Link href={`/assets/${r.assetId}`} className="text-sm font-medium text-foreground hover:text-primary">
                      {r.assetName}
                    </Link>
                    <div className="mt-0.5"><StatePill state={r.state} /></div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="tnum text-sm font-semibold text-foreground">{usd(r.amount)}</div>
                  <div className="text-[11px] text-muted">{num(r.amount)} future deeds</div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Activity */}
      <section>
        <SectionHeader title="Your activity" subtitle="Contributions, claims, wraps & yield" href="/activity" hrefLabel="Full feed" />
        <Card>
          <EventList events={portfolioActivity} limit={10} emptyHint="No activity for this wallet yet." />
        </Card>
      </section>
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  valueClass = "text-foreground",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="text-left sm:text-right">
      <div className="text-[11px] text-muted-2">{label}</div>
      <div className={`tnum text-sm font-semibold ${valueClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
