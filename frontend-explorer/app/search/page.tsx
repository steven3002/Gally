import Link from "next/link";
import { searchAll } from "@/lib/mock/registry";
import type { ObjectKind } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Card, Empty } from "@/components/ui/primitives";
import { Activity, Coins, Layers, Scale, Search, Settings, Shield, Wallet } from "@/components/ui/icons";

const KIND_ICON: Record<ObjectKind, (p: { className?: string }) => React.ReactNode> = {
  asset: Layers,
  token: Coins,
  validator: Shield,
  account: Wallet,
  dispute: Scale,
  tx: Activity,
  config: Settings,
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const results = searchAll(q, 60);

  return (
    <div>
      <PageHeader
        title="Search"
        subtitle={q ? `${results.length} result${results.length === 1 ? "" : "s"} for “${q}”` : "Find any asset, account, validator, dispute, token or transaction."}
        crumbs={[{ label: "Explore", href: "/" }, { label: "Search" }]}
      />

      {q.trim() === "" ? (
        <Card className="p-8">
          <Empty icon={<Search className="h-8 w-8" />} title="Start typing" hint="Press ⌘K anywhere to open the command palette, or paste an object id / address / tx digest." />
        </Card>
      ) : results.length === 0 ? (
        <Card className="p-8">
          <Empty icon={<Search className="h-8 w-8" />} title="No matches" hint={`Nothing indexed for “${q}”.`} />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {results.map((r) => {
              const Icon = KIND_ICON[r.kind];
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <Link href={r.route} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{r.title}</div>
                      <div className="truncate text-xs text-muted">{r.subtitle}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-2">{r.kind}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
