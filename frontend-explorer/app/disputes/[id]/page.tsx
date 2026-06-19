import { notFound } from "next/navigation";
import Link from "next/link";
import { disputes } from "@/lib/mock/data";
import { data, isLive } from "@/lib/data";
import { evidenceOf } from "@/lib/mock/documents";
import { accountByAddr } from "@/lib/mock/accounts";
import { cn, relTime, shortAddr, shortDate, usd } from "@/lib/format";
import { Avatar, Card, CardHeader, Stat } from "@/components/ui/primitives";
import { DisputeStatusPill, KV, Bar } from "@/components/ui/bits";
import { VoteBar } from "@/components/dispute/DisputeCard";
import { CrankButton } from "@/components/tx/CrankButton";
import { cranksForDispute } from "@/lib/mock/cranks";
import { WalrusDoc } from "@/components/ui/WalrusDoc";
import type { ProtocolEvent } from "@/lib/types";
import { IdLink } from "@/components/ui/IdLink";
import { ChevronRight, Scale, Shield, Check, Close, Users } from "@/components/ui/icons";

export function generateStaticParams() {
  if (isLive) return []; // live: render on demand from the indexer
  return disputes.map((d) => ({ id: d.id }));
}

export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await data.getDispute(id);
  if (!d) notFound();

  const [target, asset, assetEvents] = await Promise.all([
    data.getValidator(d.targetPoolId),
    data.getAsset(d.assetId),
    data.eventsForAsset(d.assetId, 100),
  ]);
  const evidence = evidenceOf(d.id);
  const open = d.status === "OPEN";
  const upheld = d.status === "UPHELD";
  const resolveCrank = cranksForDispute(d)[0]; // resolve_dispute when the vote window has elapsed

  // Jury roll-call: reconstructed from the JurorVoted events for this asset (§18.3).
  const jurorVotes = (assetEvents as ProtocolEvent[])
    .filter((e) => e.type === "JurorVoted")
    .map((e) => ({
      address: e.actor ?? "",
      vote: e.summary.toLowerCase().includes("guilty") ? ("guilty" as const) : ("innocent" as const),
      tsMs: e.tsMs,
    }))
    .sort((a, b) => a.tsMs - b.tsMs);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <Link href="/disputes" className="hover:text-foreground">Disputes</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">{d.assetName}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Scale className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Dispute vs{" "}
              <Link href={`/validators/${d.targetPoolId}`} className="text-foreground hover:text-primary hover:underline">
                {d.targetValidatorName}
              </Link>
            </h1>
            <p className="mt-1 text-sm text-muted">
              Over{" "}
              <Link href={`/assets/${d.assetId}`} className="text-primary hover:underline">{d.assetName}</Link>
              {" "}· opened {shortDate(d.openedAtMs)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-2">
              Challenger <IdLink id={d.challenger} /> · Dispute <IdLink id={d.id} />
            </div>
          </div>
        </div>
        <DisputeStatusPill status={d.status} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Challenger bond" value={usd(d.bond)} sub={upheld ? "refunded + bounty" : open ? "at risk" : "forfeited"} />
        </Card>
        <Card className="p-5">
          <Stat label="Votes" value={`${d.votesGuilty + d.votesInnocent}/${d.quorum}`} icon={<Users className="h-4 w-4" />} sub="cast / quorum" />
        </Card>
        <Card className="p-5">
          <Stat label="Guilty / Innocent" value={`${d.votesGuilty} / ${d.votesInnocent}`} sub="jury tally" />
        </Card>
        <Card className="p-5">
          <Stat label={open ? "Voting closes" : "Resolved"} value={relTime(d.votingDeadlineMs)} sub={shortDate(d.votingDeadlineMs)} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          {/* Evidence — the on-chain primary artifact */}
          <Card className="p-5">
            <CardHeader title="On-chain evidence" subtitle="The challenger's sha256-pinned counter-evidence" className="px-0 pt-0" />
            <div className="mt-4">
              {evidence ? (
                <WalrusDoc doc={evidence} />
              ) : (
                <p className="text-sm text-muted">No evidence document attached.</p>
              )}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-2">Challenger&apos;s stated claim</div>
              <p className="mt-1 text-sm text-muted">{d.reason}</p>
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-2">
                <Shield className="mt-0.5 h-3 w-3 shrink-0 text-positive" />
                Off-chain summary only — the binding artifact is the content-pinned evidence above, not this text.
              </p>
            </div>
          </Card>

          {/* Jury */}
          <Card className="p-5">
            <CardHeader title="Jury" subtitle="One staked pool, one vote — the target is excluded" className="px-0 pt-0" />
            <div className="mt-4">
              <VoteBar dispute={d} />
            </div>
            {jurorVotes.length > 0 && (
              <div className="mt-4 divide-y divide-border border-t border-border">
                {jurorVotes.map((j, i) => {
                  const label = accountByAddr(j.address).label ?? shortAddr(j.address, 8, 6);
                  const guilty = j.vote === "guilty";
                  return (
                    <div key={`${j.address}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                      <Link href={`/address/${j.address}`} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
                        <Avatar seed={j.address} label={label} size={28} rounded="rounded-md" />
                        <span className="truncate text-sm font-medium text-foreground">{label}</span>
                      </Link>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", guilty ? "text-danger" : "text-positive")}>
                        {guilty ? <Close className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                        {guilty ? "Guilty" : "Innocent"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Side */}
        <div className="space-y-6 xl:col-span-4">
          {/* Resolution / restitution */}
          <Card className="p-5">
            <CardHeader title="Resolution" className="px-0 pt-0" />
            {open ? (
              <>
                <p className="mt-3 text-sm text-muted">
                  Voting is in progress. If upheld, the validator&apos;s coverage is slashed into this
                  asset&apos;s compensation pool and the challenger is refunded plus a bounty.
                </p>
                {resolveCrank && (
                  <div className="mt-3 flex flex-col items-start gap-1.5">
                    <CrankButton op={resolveCrank} size="md" />
                    <p className="text-[11px] text-muted-2">{resolveCrank.reason}</p>
                  </div>
                )}
              </>
            ) : upheld ? (
              <div className="mt-3">
                <Bar>
                  <KV label="Stake slashed"><span className="text-danger">{usd(d.slashed ?? 0)}</span></KV>
                  <KV label="→ Challenger bounty"><span className="text-positive">{usd(d.bounty ?? 0)}</span></KV>
                  <KV label="→ Compensation pool">{usd(Math.max(0, (d.slashed ?? 0) - (d.bounty ?? 0)))}</KV>
                  <KV label="Validator">Slashed — pool terminal</KV>
                </Bar>
                <p className="mt-2 text-[11px] text-muted-2">
                  Slashed funds sweep into the index after the compensation grace window; wrapped
                  holders must unwrap to remain eligible.
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <Bar>
                  <KV label="Bond forfeited">{usd(d.bond)}</KV>
                  <KV label="Split">50/50 jurors & target</KV>
                  <KV label="Validator">Unfrozen — attestation upheld</KV>
                </Bar>
              </div>
            )}
          </Card>

          {/* Parties */}
          <Card className="p-5">
            <CardHeader title="Parties" className="px-0 pt-0" />
            <div className="mt-3 flex flex-col gap-2">
              <RefRow label="Challenger" value={d.challenger} />
              {target && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">Target validator</span>
                  <Link href={`/validators/${target.poolId}`} className="text-xs font-medium text-foreground hover:text-primary">
                    {target.name}
                  </Link>
                </div>
              )}
              <RefRow label="Target pool" value={d.targetPoolId} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Asset</span>
                <Link href={`/assets/${d.assetId}`} className="text-xs font-medium text-foreground hover:text-primary">
                  {asset?.name ?? d.assetName}
                </Link>
              </div>
              <RefRow label="Dispute object" value={d.id} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted">{label}</span>
      <IdLink id={value} />
    </div>
  );
}
