import { notFound } from "next/navigation";
import Link from "next/link";
import {
  assets,
  disputesForPool,
  validatorByPool,
  validators,
} from "@/lib/mock/data";
import { eventsForActor } from "@/lib/mock/activity";
import { num, pct, relTime, shortDate, usd, usdCompact } from "@/lib/format";
import {
  Avatar,
  Card,
  CardHeader,
  ProgressBar,
  Stat,
} from "@/components/ui/primitives";
import { Bar, KV } from "@/components/ui/bits";
import { RingGauge, Sparkline } from "@/components/ui/charts";
import { Tabs } from "@/components/ui/Tabs";
import { AddressChip } from "@/components/ui/AddressChip";
import { ValidatorStatusPill } from "@/components/validator/ValidatorCard";
import { AssetTable } from "@/components/asset/AssetTable";
import { DisputeCard } from "@/components/dispute/DisputeCard";
import { EventList } from "@/components/events/EventList";
import { ChevronRight, Lock, Coins, Shield } from "@/components/ui/icons";

export function generateStaticParams() {
  return validators.map((v) => ({ id: v.poolId }));
}

export default async function ValidatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const v = validatorByPool[id];
  if (!v) notFound();

  const vouched = assets.filter((a) => a.validatorPoolId === v.poolId);
  const pendingDisputes = disputesForPool(v.poolId);
  const events = eventsForActor(v.address);
  const utilization = v.stake > 0 ? (v.locked / v.stake) * 100 : 0;
  const repColor =
    v.reputation >= 85 ? "var(--positive)" : v.reputation >= 60 ? "var(--warning)" : "var(--danger)";

  const tabs = [
    {
      id: "assets",
      label: "Vouched assets",
      count: vouched.length,
      content:
        vouched.length > 0 ? (
          <Card>
            <AssetTable assets={vouched} />
          </Card>
        ) : (
          <Card className="py-12 text-center text-sm text-muted">No assets vouched.</Card>
        ),
    },
    {
      id: "disputes",
      label: "Disputes",
      count: pendingDisputes.length,
      content:
        pendingDisputes.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {pendingDisputes.map((d) => (
              <DisputeCard key={d.id} dispute={d} />
            ))}
          </div>
        ) : (
          <Card className="py-12 text-center text-sm text-muted">
            No disputes raised against this validator.
          </Card>
        ),
    },
    {
      id: "activity",
      label: "Activity",
      count: events.length,
      content: (
        <Card>
          <EventList events={events} emptyHint="No on-chain activity for this validator yet." />
        </Card>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href="/validators" className="hover:text-foreground">Validators</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">{v.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Avatar seed={v.poolId} label={v.name} size={56} rounded="rounded-full" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{v.name}</h1>
            <div className="mt-1.5 flex items-center gap-2">
              <ValidatorStatusPill status={v.status} />
              <span className="text-xs text-muted">
                Registered {shortDate(v.registeredAtMs)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-muted">Reputation</div>
            <div className="text-xs text-muted-2">{v.assetsVouched} lifetime vouches</div>
          </div>
          <RingGauge
            value={v.reputation}
            size={64}
            thickness={7}
            color={repColor}
            label={<span className="tnum text-sm font-bold">{v.reputation}</span>}
          />
        </div>
      </div>

      {v.status === "FROZEN" && (
        <Card className="border-warning/30">
          <div className="flex items-start gap-3 bg-warning-soft p-4 text-sm">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="font-semibold text-foreground">Pool frozen — under dispute.</p>
              <p className="mt-0.5 text-muted">
                All of this validator&apos;s pending milestone approvals are halted until the open
                dispute resolves.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Total stake" value={usdCompact(v.stake)} icon={<Coins className="h-4 w-4" />} sub="USDC collateral" />
        </Card>
        <Card className="p-5">
          <Stat label="Active vouches" value={num(v.activeVouches)} icon={<Shield className="h-4 w-4" />} sub="live attestations" />
        </Card>
        <Card className="p-5">
          <Stat label="Milestones approved" value={num(v.milestonesApproved)} sub="lifetime" />
        </Card>
        <Card className="p-5">
          <Stat
            label="Disputes"
            value={`${v.disputesUpheld}/${v.disputesAgainst}`}
            deltaTone={v.disputesUpheld > 0 ? "danger" : "muted"}
            sub="upheld / total"
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <Card className="p-5">
            <CardHeader title="Stake over time" subtitle="Collateral deposited & topped up" className="px-0 pt-0" />
            <div className="mt-4">
              <Sparkline data={v.stakeSpark} color={repColor} width={760} height={140} className="w-full" strokeWidth={2.4} />
            </div>
          </Card>

          <Card className="p-5">
            <Tabs tabs={tabs} />
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-4">
          <Card className="p-5">
            <CardHeader title="Stake utilization" className="px-0 pt-0" />
            <div className="mt-3 flex items-center justify-between">
              <div>
                <div className="tnum text-2xl font-bold text-foreground">{pct(utilization, 0)}</div>
                <div className="text-xs text-muted">of stake committed</div>
              </div>
              <RingGauge value={utilization} size={64} thickness={7} color="var(--info)" label={<span className="tnum text-xs font-semibold">{pct(utilization, 0)}</span>} />
            </div>
            <div className="mt-3">
              <ProgressBar value={utilization} tone="info" height="h-2" />
            </div>
            <div className="mt-3">
              <Bar>
                <KV label="Committed">{usd(v.locked)}</KV>
                <KV label="Free stake">{usd(v.stake - v.locked)}</KV>
                <KV label="Max loss per asset">{usd(Math.round(v.locked / Math.max(1, v.activeVouches)))}</KV>
              </Bar>
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="On-chain references" className="px-0 pt-0" />
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Validator pool</span>
                <AddressChip address={v.poolId} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Operator</span>
                <AddressChip address={v.address} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
