import { notFound } from "next/navigation";
import Link from "next/link";
import { assets, assetById, DEMO_WALLET } from "@/lib/mock/data";
import { holderDistribution, supplyOf } from "@/lib/mock/holders";
import { num } from "@/lib/format";
import { Avatar, Card, CardHeader, Empty } from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/bits";
import { Distribution } from "@/components/holders/Distribution";
import { HolderTable } from "@/components/holders/HolderTable";
import { ChevronRight, Users } from "@/components/ui/icons";

export function generateStaticParams() {
  return assets.map((a) => ({ id: a.id }));
}

export default async function AssetHoldersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = assetById[id];
  if (!asset) notFound();

  const holders = holderDistribution(asset.id);
  const supply = supplyOf(asset.id);
  const tokenSymbol = asset.accumulator?.tokenSymbol;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href="/assets" className="hover:text-foreground">Assets</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href={`/assets/${asset.id}`} className="hover:text-foreground">{asset.name}</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">Holders</span>
      </nav>

      {/* Header */}
      <div className="flex items-start gap-4">
        <Avatar seed={asset.id} label={asset.ticker} size={52} />
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground">
            {asset.name} holders
            <StatePill state={asset.state} />
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <Users className="h-3.5 w-3.5" />
            {num(holders.length)} holders of {num(supply.minted)} shares · 1 share = 1 USDC
          </p>
        </div>
      </div>

      {holders.length === 0 ? (
        <Card className="p-8">
          <Empty
            icon={<Users className="h-8 w-8" />}
            title="No holders yet"
            hint="GallyShare deeds are minted only once the raise finalizes. This asset has no holder ledger yet."
          />
        </Card>
      ) : (
        <>
          {/* Distribution + supply */}
          <Card className="p-5">
            <CardHeader title="Distribution" subtitle="Holder concentration & supply breakdown" className="px-0 pt-0" />
            <div className="mt-4">
              <Distribution holders={holders} supply={supply} tokenSymbol={tokenSymbol} />
            </div>
          </Card>

          {/* Full ledger */}
          <Card>
            <CardHeader title="Holder ledger" subtitle="Ranked by total holding — deeds (yield-bearing) + wrapped Coin<T>" />
            <div className="mt-2">
              <HolderTable holders={holders} tokenSymbol={tokenSymbol} demoAddress={DEMO_WALLET} pageSize={20} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
