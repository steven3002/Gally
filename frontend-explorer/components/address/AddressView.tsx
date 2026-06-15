import Link from "next/link";
import type { AccountRole, Category } from "@/lib/types";
import { CATEGORY_COLOR, num, pct, usd, usdCompact, suiscanUrl, type Tone } from "@/lib/format";
import { accountByAddr } from "@/lib/mock/accounts";
import { holdingsOf } from "@/lib/mock/holders";
import { eventsForActor } from "@/lib/mock/activity";
import { portfolioReceipts } from "@/lib/mock/data";
import {
  Avatar,
  Card,
  Empty,
  Pill,
  SectionHeader,
  Stat,
} from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/bits";
import { Donut } from "@/components/ui/charts";
import { IdLink } from "@/components/ui/IdLink";
import { EventList } from "@/components/events/EventList";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Coins,
  ExternalLink,
  Lock,
  Wallet,
} from "@/components/ui/icons";

const ROLE_TONE: Record<AccountRole, Tone> = {
  investor: "primary",
  entity: "warning",
  validator: "info",
  challenger: "danger",
  admin: "neutral",
  treasury: "positive",
};
const ROLE_LABEL: Record<AccountRole, string> = {
  investor: "Investor",
  entity: "Entity",
  validator: "Validator",
  challenger: "Challenger",
  admin: "Admin",
  treasury: "Treasury",
};

/**
 * The canonical account surface (FE-M3): holdings (GallyShare deeds + wrapped
 * Coin<T> + receipts, valued at par), role detection, sector allocation, and the
 * per-address activity feed. `/address/:addr` renders this for ANY address;
 * `/portfolio` renders it for the DEMO_WALLET with the `demo` framing — so there
 * is one address-page implementation and no duplicated holdings logic.
 */
export function AddressView({ address, demo = false }: { address: string; demo?: boolean }) {
  const account = accountByAddr(address);
  const holdings = holdingsOf(address);
  const events = eventsForActor(address);
  const receipts = demo ? portfolioReceipts : [];

  const deeds = holdings.reduce((s, h) => s + h.shareCount, 0);
  const wrapped = holdings.reduce((s, h) => s + h.wrapped, 0);
  const principal = deeds + wrapped;
  const claimable = holdings.reduce((s, h) => s + h.pendingYield, 0);
  // Lifetime yield is derived from the address's own YieldClaimed events (§5.3).
  const yieldEarned = events
    .filter((e) => e.type === "YieldClaimed")
    .reduce((s, e) => s + (e.amount ?? 0), 0);
  const claimablePositions = holdings.filter((h) => h.pendingYield > 0).length;

  const allocation = Object.entries(
    holdings.reduce<Record<string, number>>((acc, h) => {
      acc[h.category] = (acc[h.category] ?? 0) + h.shareCount + h.wrapped;
      return acc;
    }, {}),
  ).map(([category, value]) => ({
    label: category,
    value,
    color: CATEGORY_COLOR[category as Category],
  }));

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">{demo ? "Portfolio" : "Account"}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Avatar seed={address} size={56} label={account.label} rounded="rounded-2xl" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground">
              {demo ? "Portfolio" : account.label ?? "Account"}
              {demo && (
                <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">
                  Demo wallet
                </span>
              )}
            </h1>
            <div className="mt-1">
              <IdLink id={address} lead={14} tail={10} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {account.roles.map((r) => (
                <Pill key={r} tone={ROLE_TONE[r]}>{ROLE_LABEL[r]}</Pill>
              ))}
              {!account.known && <span className="text-[11px] text-muted-2">unlabelled address</span>}
            </div>
          </div>
        </div>
        <a
          href={suiscanUrl(address, "account")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" /> Suiscan
        </a>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Holdings value" value={usdCompact(principal)} icon={<Wallet className="h-4 w-4" />} sub={`${num(principal)} shares`} />
        </Card>
        <Card className="p-5">
          <Stat label="Deeds" value={usdCompact(deeds)} icon={<Coins className="h-4 w-4" />} sub="yield-bearing" />
        </Card>
        <Card className="p-5">
          <Stat label="Wrapped" value={usdCompact(wrapped)} icon={<Lock className="h-4 w-4" />} sub="no yield" />
        </Card>
        <Card className="p-5">
          <Stat label={yieldEarned > 0 ? "Yield earned" : "Claimable yield"} value={usd(yieldEarned > 0 ? yieldEarned : claimable)} sub={yieldEarned > 0 ? `+${usd(claimable)} claimable` : `across ${holdings.length} position${holdings.length === 1 ? "" : "s"}`} />
        </Card>
      </div>

      {/* Claimable banner (observer affordance — non-functional) */}
      {demo && claimable > 0 && (
        <Card className="flex flex-col items-start justify-between gap-3 border-positive/30 bg-positive-soft/40 p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-positive/15 text-positive">
              <Coins className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-foreground">{usd(claimable)} in yield ready to claim</div>
              <div className="text-xs text-muted">
                Accrued via the lazy index on your GallyShare deeds across {claimablePositions}{" "}
                position{claimablePositions === 1 ? "" : "s"}. Wrapped tokens are not included.
              </div>
            </div>
          </div>
          <button disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-positive px-4 py-2 text-sm font-semibold text-white opacity-90" title="Available in-wallet">
            Claim all <ArrowRight className="h-4 w-4" />
          </button>
        </Card>
      )}

      {/* Holdings + allocation */}
      {holdings.length === 0 ? (
        <section>
          <SectionHeader title="Holdings" subtitle="GallyShare deeds + wrapped Coin<T>, valued at par" />
          <Card className="p-8">
            <Empty icon={<Coins className="h-8 w-8" />} title="No share holdings" hint="This address holds no GallyShare deeds or wrapped tokens." />
          </Card>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <SectionHeader title="Holdings" subtitle="Deeds accrue yield; wrapped tokens are composable but earn none until unwrapped" />
            <Card>
              <div className="divide-y divide-border">
                {holdings.map((h) => (
                  <div key={h.assetId} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/assets/${h.assetId}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar seed={h.assetId} label={h.ticker} size={40} rounded="rounded-lg" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{h.assetName}</span>
                          <StatePill state={h.state} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-md bg-positive-soft px-2 py-0.5 font-medium text-positive">
                            <Coins className="h-3 w-3" /> {num(h.shareCount)} deeds
                          </span>
                          {h.wrapped > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 font-medium text-muted">
                              <Lock className="h-3 w-3" /> {num(h.wrapped)} {h.tokenSymbol ?? "wrapped"}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                    <div className="grid grid-cols-3 gap-x-6 gap-y-2 sm:flex sm:items-center sm:gap-8 sm:text-right">
                      <Cell label="Principal" value={usd(h.shareCount + h.wrapped)} />
                      <Cell label="Claimable" value={h.pendingYield > 0 ? `+${usd(h.pendingYield)}` : "—"} cls={h.pendingYield > 0 ? "text-positive" : "text-muted-2"} />
                      <Cell label="APY" value={h.apy > 0 ? pct(h.apy) : "—"} cls={h.apy > 0 ? "text-positive" : "text-muted-2"} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section>
            <SectionHeader title="Allocation" subtitle="By sector (principal)" />
            <Card className="flex flex-col items-center gap-4 p-5">
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
              <div className="w-full space-y-1.5">
                {allocation.map((a) => (
                  <div key={a.label} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                    <span className="truncate text-muted">{a.label}</span>
                    <span className="tnum ml-auto font-medium text-foreground">{pct((a.value / principal) * 100, 0)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        </div>
      )}

      {/* Pending receipts (demo only — soulbound contribution receipts) */}
      {receipts.length > 0 && (
        <section>
          <SectionHeader title="Contribution receipts" subtitle="Soulbound — convert to GallyShare deeds when the raise finalizes, or refund if it fails. Receipts do not earn yield." />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {receipts.map((r) => (
              <Card key={r.assetId} className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar seed={r.assetId} size={36} rounded="rounded-lg" />
                  <div>
                    <Link href={`/assets/${r.assetId}`} className="text-sm font-medium text-foreground hover:text-primary">{r.assetName}</Link>
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
        <SectionHeader title="Activity" subtitle="Every protocol event where this address is the economic actor" href={demo ? "/activity" : undefined} hrefLabel="Full feed" />
        <Card>
          {events.length === 0 ? (
            <Empty icon={<Activity className="h-8 w-8" />} title="No activity" hint="This address has not acted in any indexed transaction." />
          ) : (
            <EventList events={events} limit={25} />
          )}
        </Card>
      </section>
    </div>
  );
}

function Cell({ label, value, cls = "text-foreground" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="text-left sm:text-right">
      <div className="text-[11px] text-muted-2">{label}</div>
      <div className={`tnum text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
