import Link from "next/link";
import type { Category } from "@/lib/types";
import {
  DEMO_WALLET,
  portfolio,
  portfolioReceipts,
} from "@/lib/mock/data";
import { portfolioActivity } from "@/lib/mock/activity";
import { num, pct, pctSigned, usd, usdCompact } from "@/lib/format";
import {
  Avatar,
  Card,
  CardHeader,
  SectionHeader,
  Stat,
} from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/bits";
import { AddressChip } from "@/components/ui/AddressChip";
import { Donut, Sparkline } from "@/components/ui/charts";
import { EventList } from "@/components/events/EventList";
import { Coins, TrendUp, Wallet, ArrowRight, Lock } from "@/components/ui/icons";

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
  const totalValue = portfolio.reduce((s, p) => s + p.currentValue, 0);
  const totalCost = portfolio.reduce((s, p) => s + p.costBasis, 0);
  const totalYield = portfolio.reduce((s, p) => s + p.yieldEarned, 0);
  const totalClaimable = portfolio.reduce((s, p) => s + p.yieldClaimable, 0);
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost ? (pnl / totalCost) * 100 : 0;
  const spark = normalizedAverage(portfolio.map((p) => p.spark));

  const allocation = Object.entries(
    portfolio.reduce<Record<string, number>>((acc, p) => {
      acc[p.category] = (acc[p.category] ?? 0) + p.currentValue;
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
              <Wallet className="h-4 w-4" /> Total position value
            </div>
            <div className="tnum mt-1 text-4xl font-bold tracking-tight">{usd(totalValue)}</div>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className={pnl >= 0 ? "text-emerald-200" : "text-rose-200"}>
                {pnl >= 0 ? "▲" : "▼"} {usd(Math.abs(pnl))} ({pctSigned(pnlPct)})
              </span>
              <span className="text-white/60">all-time</span>
            </div>
            <div className="-mx-1 mt-4">
              <Sparkline data={spark} color="#ffffff" width={520} height={56} className="w-full" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-white/15 pt-4 text-sm">
              <div>
                <div className="text-white/60">Invested</div>
                <div className="tnum font-semibold">{usd(totalCost)}</div>
              </div>
              <div>
                <div className="text-white/60">Yield earned</div>
                <div className="tnum font-semibold">{usd(totalYield)}</div>
              </div>
              <div>
                <div className="text-white/60">Positions</div>
                <div className="tnum font-semibold">{portfolio.length}</div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col p-5">
          <CardHeader title="Allocation" subtitle="By sector" className="px-0 pt-0" />
          <div className="mt-2 flex flex-1 flex-col items-center justify-center gap-4 sm:flex-row">
            <Donut
              segments={allocation}
              size={150}
              thickness={18}
              center={
                <div className="text-center">
                  <div className="tnum text-lg font-bold text-foreground">{usdCompact(totalValue)}</div>
                  <div className="text-[10px] text-muted">total</div>
                </div>
              }
            />
            <div className="space-y-1.5">
              {allocation.map((a) => (
                <div key={a.label} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
                  <span className="text-muted">{a.label}</span>
                  <span className="tnum ml-auto font-medium text-foreground">
                    {pct((a.value / totalValue) * 100, 0)}
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
                Accrued via the lazy index across {portfolio.filter((p) => p.yieldClaimable > 0).length} positions.
              </div>
            </div>
          </div>
          <button className="inline-flex items-center gap-2 rounded-xl bg-positive px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
            Claim all <ArrowRight className="h-4 w-4" />
          </button>
        </Card>
      )}

      {/* Positions */}
      <section>
        <SectionHeader title="Holdings" subtitle="GallyShare deeds & wrapped tokens" />
        <Card>
          <div className="hidden grid-cols-[1.6fr_0.9fr_0.9fr_0.9fr_0.8fr] gap-3 border-b border-border px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-2 md:grid">
            <div>Asset</div>
            <div className="text-right">Shares</div>
            <div className="text-right">Value</div>
            <div className="text-right">Yield earned</div>
            <div className="text-right">APY</div>
          </div>
          <div className="divide-y divide-border">
            {portfolio.map((p) => {
              const ret = p.costBasis ? ((p.currentValue - p.costBasis) / p.costBasis) * 100 : 0;
              return (
                <Link
                  key={p.assetId}
                  href={`/assets/${p.assetId}`}
                  className="grid grid-cols-2 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2 md:grid-cols-[1.6fr_0.9fr_0.9fr_0.9fr_0.8fr]"
                >
                  <div className="flex items-center gap-3">
                    <Avatar seed={p.assetId} label={p.ticker} size={36} rounded="rounded-lg" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{p.assetName}</div>
                      <div className="mt-0.5">
                        <StatePill state={p.state} />
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-sm font-medium text-foreground">{num(p.shares + p.wrapped)}</div>
                    {p.wrapped > 0 && (
                      <div className="flex items-center justify-end gap-1 text-[11px] text-muted">
                        <Lock className="h-3 w-3" /> {num(p.wrapped)} wrapped
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="tnum text-sm font-medium text-foreground">{usd(p.currentValue)}</div>
                    <div className={`tnum text-[11px] ${ret >= 0 ? "text-positive" : "text-danger"}`}>
                      {pctSigned(ret)}
                    </div>
                  </div>
                  <div className="hidden text-right md:block">
                    <div className="tnum text-sm font-medium text-foreground">{usd(p.yieldEarned)}</div>
                    {p.yieldClaimable > 0 && (
                      <div className="tnum text-[11px] text-positive">+{usd(p.yieldClaimable)} claimable</div>
                    )}
                  </div>
                  <div className="hidden text-right md:block">
                    <span className="tnum text-sm font-semibold text-positive">
                      {p.apy > 0 ? pct(p.apy) : "—"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      </section>

      {/* Pending receipts */}
      {portfolioReceipts.length > 0 && (
        <section>
          <SectionHeader title="Contribution receipts" subtitle="Soulbound — convert to shares when the raise finalizes, or refund if it fails" />
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
                  <div className="text-[11px] text-muted">{num(r.amount)} future shares</div>
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
