import Link from "next/link";
import { protocolConfig } from "@/lib/mock/data";
import { governanceHistory, type GovEventKind } from "@/lib/mock/governance";
import { bpsToPct, DAY, HOUR, num, relTime, shortDate, usd, type Tone } from "@/lib/format";
import { Avatar, Card, CardHeader, Stat } from "@/components/ui/primitives";
import { Bar, KV, Pill } from "@/components/ui/bits";
import { IdLink } from "@/components/ui/IdLink";
import { PausePreviewToggle } from "@/components/shell/PauseBanner";
import { Check, ChevronRight, Lock, Scale, Settings, Shield } from "@/components/ui/icons";

function durationLabel(ms: number): string {
  const d = ms / DAY;
  if (d >= 1) return `${d % 1 === 0 ? d : d.toFixed(1)} day${d === 1 ? "" : "s"}`;
  const h = ms / HOUR;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

const KIND_META: Record<GovEventKind, { tone: Tone; label: string }> = {
  init: { tone: "info", label: "Genesis" },
  param: { tone: "primary", label: "Parameter" },
  treasury: { tone: "warning", label: "Treasury" },
  pause: { tone: "danger", label: "Paused" },
  resume: { tone: "positive", label: "Resumed" },
};

export default function GovernancePage() {
  const c = protocolConfig;
  const history = governanceHistory();
  const paused = c.paused;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">Governance</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Settings className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Protocol governance</h1>
            <p className="mt-1 text-sm text-muted">
              The single <code>ProtocolConfig</code> — every tunable, the pause state, and the
              parameter-change history. All values shown are read-only.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-2">
              Config <IdLink id={c.configId} /> · v{c.version} · {c.network}
            </div>
          </div>
        </div>
      </div>

      {/* Pause status */}
      <Card className={paused ? "border-danger/40" : undefined}>
        <div className={`flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between ${paused ? "bg-danger-soft" : ""}`}>
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${paused ? "bg-danger/15 text-danger" : "bg-positive-soft text-positive"}`}>
              {paused ? <Lock className="h-5 w-5" /> : <Check className="h-5 w-5" />}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {paused ? "Protocol paused" : "Protocol operational"}
                </span>
                <Pill tone={paused ? "danger" : "positive"} dot>{paused ? "Paused" : "Live"}</Pill>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                D6: the pause switch halts capital <em>entry</em> only. Exits — refunds, claims, unwraps,
                redemptions, dispute resolution — are never pause-gated.
              </p>
            </div>
          </div>
          <PausePreviewToggle />
        </div>
      </Card>

      {/* Key params */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Protocol fee" value={bpsToPct(c.protocolFeeBps)} sub="on gross revenue → treasury" />
        </Card>
        <Card className="p-5">
          <Stat label="Min validator stake" value={usd(c.minValidatorStake)} icon={<Shield className="h-4 w-4" />} sub="floor to register a pool" />
        </Card>
        <Card className="p-5">
          <Stat label="Jury quorum" value={num(c.juryQuorum)} icon={<Scale className="h-4 w-4" />} sub={`${bpsToPct(c.juryThresholdBps)} guilty threshold`} />
        </Card>
        <Card className="p-5">
          <Stat label="Dispute window" value={durationLabel(c.disputeWindowMs)} sub="voting period" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* All tunables */}
        <Card className="p-5">
          <CardHeader title="Parameters" subtitle="Every ProtocolConfig tunable (§3.1)" className="px-0 pt-0" />
          <div className="mt-2">
            <Bar>
              <KV label="Protocol fee">{bpsToPct(c.protocolFeeBps)}</KV>
              <KV label="Vouch coverage">{bpsToPct(c.vouchCoverageBps)} of funding goal</KV>
              <KV label="Min validator stake">{usd(c.minValidatorStake)}</KV>
              <KV label="Challenger bond">{usd(c.challengerBond)}</KV>
              <KV label="Challenger bounty">{bpsToPct(c.challengerBountyBps)} of slash</KV>
              <KV label="Jury quorum">{num(c.juryQuorum)} votes</KV>
              <KV label="Jury threshold">{bpsToPct(c.juryThresholdBps)} guilty</KV>
              <KV label="Jury min stake">{usd(c.juryMinStake)}</KV>
              <KV label="Dispute window">{durationLabel(c.disputeWindowMs)}</KV>
              <KV label="Compensation grace">{durationLabel(c.compensationGraceMs)}</KV>
              <KV label="Min wrap duration">{durationLabel(c.minWrapDurationMs)}</KV>
              <KV label="Config version">v{c.version}</KV>
            </Bar>
          </div>
        </Card>

        {/* Addresses */}
        <Card className="h-fit p-5">
          <CardHeader title="Protocol addresses" className="px-0 pt-0" />
          <div className="mt-3 space-y-3">
            <AddrRow label="Admin (AdminCap holder)" value={c.admin} note="Soulbound cap — no `store`, non-transferable" />
            <AddrRow label="Treasury (fee destination)" value={c.treasury} note="Receives the protocol fee on every deposit" />
            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted">Config object</span>
              <IdLink id={c.configId} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Package</span>
              <IdLink id={c.packageId} />
            </div>
          </div>
        </Card>
      </div>

      {/* Parameter-change history */}
      <Card>
        <CardHeader title="Parameter-change history" subtitle="Governance is event-only on chain (§18.3) — newest first" />
        <div className="mt-2 divide-y divide-border">
          {history.map((h) => {
            const m = KIND_META[h.kind];
            return (
              <div key={h.txDigest + h.tsMs} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <Pill tone={m.tone}>{m.label}</Pill>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{h.title}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-2">{h.detail}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 pl-12 sm:pl-0">
                  <span className="text-xs text-muted" title={shortDate(h.tsMs)}>{relTime(h.tsMs)}</span>
                  <IdLink id={h.txDigest} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function AddrRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Avatar seed={value} size={32} rounded="rounded-lg" />
        <div className="min-w-0">
          <Link href={`/address/${value}`} className="text-sm font-medium text-foreground hover:text-primary">{label}</Link>
          <div className="text-[11px] text-muted-2">{note}</div>
        </div>
      </div>
      <IdLink id={value} />
    </div>
  );
}
