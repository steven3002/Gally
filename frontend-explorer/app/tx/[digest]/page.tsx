import Link from "next/link";
import { data } from "@/lib/data";
import { accountByAddr } from "@/lib/mock/accounts";
import { shortDate, relTime, suiscanUrl, shortAddr } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { Card, CardHeader, Empty, Avatar } from "@/components/ui/primitives";
import { KV, Bar } from "@/components/ui/bits";
import { IdLink } from "@/components/ui/IdLink";
import { EventList } from "@/components/events/EventList";
import { Activity, ChevronRight, ExternalLink } from "@/components/ui/icons";

export default async function TxPage({ params }: { params: Promise<{ digest: string }> }) {
  const { digest } = await params;
  const tx = await data.getTx(decodeURIComponent(digest));

  if (!tx) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Card className="p-8">
          <Empty icon={<Activity className="h-8 w-8" />} title="Transaction not found" hint={`No indexed events for ${digest}.`} />
        </Card>
      </div>
    );
  }

  // affected entities
  const assetIds = Array.from(new Set(tx.events.map((e) => e.assetId).filter(Boolean))) as string[];
  const actors = Array.from(new Set(tx.events.map((e) => e.actor).filter(Boolean))) as string[];
  const assetEntries = await Promise.all(assetIds.map(async (id) => [id, await data.getAsset(id)] as const));
  const assetMap: Record<string, Asset | null> = Object.fromEntries(assetEntries);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href="/activity" className="hover:text-foreground">Activity</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">Transaction</span>
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Activity className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Transaction</h1>
            <p className="break-all font-mono text-xs text-muted">{tx.digest}</p>
          </div>
        </div>
        <a
          href={suiscanUrl(tx.digest, "tx")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" /> View on Suiscan
        </a>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <CardHeader title="Overview" className="px-0 pt-0" />
          <div className="mt-2">
            <Bar>
              <KV label="Events">{tx.events.length}</KV>
              <KV label="Headline">{tx.kind}</KV>
              <KV label="Timestamp">{shortDate(tx.tsMs)}</KV>
              <KV label="Age">{relTime(tx.tsMs)}</KV>
            </Bar>
          </div>

          {(assetIds.length > 0 || actors.length > 0) && (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              {assetIds.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted-2">Assets</div>
                  <div className="flex flex-wrap gap-2">
                    {assetIds.map((id) => (
                      <Link
                        key={id}
                        href={`/assets/${id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-foreground hover:border-border-strong"
                      >
                        <Avatar seed={id} label={assetMap[id]?.ticker ?? "?"} size={16} rounded="rounded" />
                        {assetMap[id]?.name ?? id}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {actors.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted-2">Accounts</div>
                  <div className="flex flex-col gap-1.5">
                    {actors.map((a) => {
                      const acc = accountByAddr(a);
                      return <IdLink key={a} id={a} label={acc.label ?? shortAddr(a)} />;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Events in this transaction" subtitle={`${tx.events.length} emitted`} />
          <div className="mt-1">
            <EventList events={[...tx.events].sort((a, b) => a.tsMs - b.tsMs)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
