import Link from "next/link";
import type { AccountRole } from "@/lib/types";
import type { Tone } from "@/lib/format";
import { accountByAddr } from "@/lib/mock/accounts";
import { holdingsOf } from "@/lib/mock/holders";
import { eventsForActor } from "@/lib/mock/activity";
import { num, usd, usdCompact, pct, shortAddr, suiscanUrl } from "@/lib/format";
import { Avatar, Card, CardHeader, Empty, Pill, Stat } from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/bits";
import { EventList } from "@/components/events/EventList";
import { Coins, Lock, ExternalLink, ChevronRight, Wallet, Activity } from "@/components/ui/icons";

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

export default async function AddressPage({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = await params;
  const address = decodeURIComponent(addr);
  const account = accountByAddr(address);
  const holdings = holdingsOf(address);
  const events = eventsForActor(address);

  const deeds = holdings.reduce((s, h) => s + h.shareCount, 0);
  const wrapped = holdings.reduce((s, h) => s + h.wrapped, 0);
  const principal = deeds + wrapped;
  const claimable = holdings.reduce((s, h) => s + h.pendingYield, 0);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">Account</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Avatar seed={address} size={56} rounded="rounded-2xl" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {account.label ?? "Account"}
            </h1>
            <p className="break-all font-mono text-xs text-muted">{address}</p>
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
          <Stat label="Claimable yield" value={usd(claimable)} sub={`across ${holdings.length} position${holdings.length === 1 ? "" : "s"}`} />
        </Card>
      </div>

      {/* Holdings */}
      <section>
        <CardHeader title="Holdings" subtitle="GallyShare deeds (yield-bearing) + wrapped Coin<T> (no yield until unwrapped)" />
        {holdings.length === 0 ? (
          <Card className="p-8">
            <Empty icon={<Coins className="h-8 w-8" />} title="No share holdings" hint="This address holds no GallyShare deeds or wrapped tokens." />
          </Card>
        ) : (
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
        )}
      </section>

      {/* Activity */}
      <section>
        <CardHeader title="Activity" subtitle="Every protocol event where this address is the economic actor" />
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
