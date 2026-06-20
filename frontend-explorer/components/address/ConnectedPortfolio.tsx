"use client";

// FE-M8b — The connected wallet's live Position (wallet-RPC owned-object reads).
//
// `/portfolio` in live mode renders THIS instead of the mock-selector AddressView:
// the deeds (`GallyShare`), wrapped (`Coin<T>`), cost-basis and **claimable** are read
// straight from the connected wallet over RPC — facts that are deliberately NOT indexed
// (guard rails R3/R8). Derived/historical context (asset metadata, the per-address
// activity feed) still comes from the indexer through the data seam. When no wallet is
// connected it shows a connect prompt above the demo preview (the server `fallback`).
//
// The forms/cards (`HoldingActions`, `UnwrapAlert`, …) are reused unchanged — only the
// DATA SOURCE for the connected wallet changes, proving the FE-M7.2 seam a second time.

import { useEffect, type ReactNode } from "react";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import type { Category } from "@/lib/types";
import { data } from "@/lib/data";
import { useOwnedDeeds, useOwnedCoinBalances, buildConnectedHoldings } from "@/lib/data/position";
import { useOptimistic } from "@/lib/tx/optimistic";
import { CATEGORY_COLOR, num, pct, usd, usdCompact, suiscanUrl } from "@/lib/format";
import { Avatar, Card, Empty, SectionHeader, Stat } from "@/components/ui/primitives";
import { RandomNftAvatar } from "@/components/onboarding/RandomNftAvatar";
import { StatePill } from "@/components/ui/bits";
import { Donut } from "@/components/ui/charts";
import { IdLink } from "@/components/ui/IdLink";
import { EventList } from "@/components/events/EventList";
import { UnwrapAlert } from "@/components/health/UnwrapAlert";
import { HoldingActions } from "@/components/tx/HoldingActions";
import { Activity, Coins, ExternalLink, Lock, Wallet } from "@/components/ui/icons";

export function ConnectedPortfolio({ fallback }: { fallback: ReactNode }) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { deeds, isLoading: deedsLoading, refetch: refetchDeeds } = useOwnedDeeds();
  const { balances, refetch: refetchBalances } = useOwnedCoinBalances();
  const { applied } = useOptimistic();
  const address = account?.address ?? "";

  // A stable signature of the owned-deed set so the holdings query re-runs when the
  // wallet's objects change (e.g. after a wrap/claim) — and on every optimistic apply.
  const deedSig = deeds.map((d) => `${d.objectId}:${d.shareIndexRaw}`).sort().join(",");
  const balSig = [...balances.entries()].map(([k, v]) => `${k}:${v}`).sort().join(",");

  const { data: holdings = [] } = useQuery({
    queryKey: ["connected-holdings", address, deedSig, balSig],
    enabled: !!account && deeds.length > 0,
    queryFn: () => buildConnectedHoldings(client, address, deeds, balances),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["connected-activity", address],
    enabled: !!account,
    queryFn: () => data.addressActivity(address),
  });

  // Reconcile against the real chain result: every successful live action pushes an
  // optimistic key; when that set changes we re-read the wallet's owned objects from
  // RPC, so the Position (deeds/wrapped/claimable) refreshes to the settled truth.
  useEffect(() => {
    if (!account) return;
    refetchDeeds();
    refetchBalances();
  }, [applied, account, refetchDeeds, refetchBalances]);

  if (!account) {
    return (
      <div className="space-y-6">
        <Card className="flex flex-col items-start gap-3 border-primary/30 bg-primary-soft/30 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-bold text-foreground">Connect your wallet to see your live portfolio</div>
              <div className="text-xs text-muted">
                Your GallyShare deeds, wrapped tokens and claimable yield are read directly from chain. Use{" "}
                <span className="font-semibold text-foreground">Connect</span> in the top bar.
              </div>
            </div>
          </div>
        </Card>
        <SectionHeader title="Example portfolio" subtitle="Demo data — connect a wallet to replace this with your live positions" />
        {fallback}
      </div>
    );
  }

  const deeds_total = holdings.reduce((s, h) => s + h.shareCount, 0);
  const wrapped = holdings.reduce((s, h) => s + h.wrapped, 0);
  const principal = deeds_total + wrapped;
  const claimable = holdings.reduce((s, h) => s + h.pendingYield, 0);
  const yieldEarned = events.filter((e) => e.type === "YieldClaimed").reduce((s, e) => s + (e.amount ?? 0), 0);

  const allocation = Object.entries(
    holdings.reduce<Record<string, number>>((acc, h) => {
      acc[h.category] = (acc[h.category] ?? 0) + h.shareCount + h.wrapped;
      return acc;
    }, {}),
  ).map(([category, value]) => ({ label: category, value, color: CATEGORY_COLOR[category as Category] }));

  return (
    <div className="space-y-6">
      {/* Header — the CONNECTED wallet, read live from RPC */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <RandomNftAvatar address={address} size={56} label="You" rounded="rounded-2xl" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground">
              Portfolio
              <span className="rounded bg-positive-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-positive">Live · your wallet</span>
            </h1>
            <div className="mt-1">
              <IdLink id={address} lead={14} tail={10} />
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
          <Stat label="Deeds" value={usdCompact(deeds_total)} icon={<Coins className="h-4 w-4" />} sub="yield-bearing" />
        </Card>
        <Card className="p-5">
          <Stat label="Wrapped" value={usdCompact(wrapped)} icon={<Lock className="h-4 w-4" />} sub="no yield" />
        </Card>
        <Card className="p-5">
          <Stat label={yieldEarned > 0 ? "Yield earned" : "Claimable yield"} value={usd(yieldEarned > 0 ? yieldEarned : claimable)} sub={yieldEarned > 0 ? `+${usd(claimable)} claimable` : `across ${holdings.length} position${holdings.length === 1 ? "" : "s"}`} />
        </Card>
      </div>

      <UnwrapAlert holdings={holdings} />

      {/* Holdings + allocation */}
      {deedsLoading && holdings.length === 0 ? (
        <Card className="p-8">
          <Empty icon={<Coins className="h-8 w-8" />} title="Reading your wallet…" hint="Fetching owned GallyShare deeds and token balances from chain." />
        </Card>
      ) : holdings.length === 0 ? (
        <Card className="p-8">
          <Empty icon={<Coins className="h-8 w-8" />} title="No share holdings" hint="This wallet holds no GallyShare deeds or wrapped tokens yet." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <SectionHeader title="Holdings" subtitle="Read live from your connected wallet — deeds accrue yield; wrapped tokens earn none until unwrapped" />
            <div className="space-y-3">
              {holdings.map((h) => (
                <div key={h.assetId} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-sm)] transition-colors hover:border-border-strong">
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <a href={`/assets/${h.assetId}`} className="group flex min-w-0 items-center gap-3">
                        <Avatar seed={h.assetId} label={h.ticker} size={40} rounded="rounded-lg" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">{h.assetName}</span>
                            <StatePill state={h.state} />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
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
                      </a>
                      <div className="shrink-0 text-right">
                        <div className="tnum text-sm font-bold text-foreground">{usd(h.shareCount + h.wrapped)}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-2">principal</div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-2/50">
                      <MiniStat label="Claimable" value={h.pendingYield > 0 ? `+${usd(h.pendingYield)}` : "—"} cls={h.pendingYield > 0 ? "text-positive" : "text-muted-2"} />
                      <MiniStat label="APY" value={h.apy > 0 ? pct(h.apy) : "—"} cls={h.apy > 0 ? "text-positive" : "text-muted-2"} />
                    </div>
                  </div>

                  <HoldingActions
                    owner={address}
                    assetId={h.assetId}
                    assetName={h.assetName}
                    tokenSymbol={h.tokenSymbol}
                    shareCount={h.shareCount}
                    wrapped={h.wrapped}
                    pendingYield={h.pendingYield}
                    frozen={h.frozen}
                  />
                </div>
              ))}
            </div>
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

      {/* Activity (indexer-derived, actor-scoped) */}
      <section>
        <SectionHeader title="Activity" subtitle="Every protocol event where this wallet is the economic actor" href="/activity" hrefLabel="Full feed" />
        <Card>
          {events.length === 0 ? (
            <Empty icon={<Activity className="h-8 w-8" />} title="No activity" hint="This wallet has not acted in any indexed transaction." />
          ) : (
            <EventList events={events} pageSize={20} />
          )}
        </Card>
      </section>
    </div>
  );
}

function MiniStat({ label, value, cls = "text-foreground" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-2">{label}</div>
      <div className={`tnum mt-0.5 text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
