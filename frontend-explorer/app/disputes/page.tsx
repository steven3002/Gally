import { PageHeader } from "@/components/PageHeader";
import { Card, SectionHeader, Stat } from "@/components/ui/primitives";
import { Paginated } from "@/components/ui/Pager";
import { DisputeCard } from "@/components/dispute/DisputeCard";
import { protocolConfig } from "@/lib/mock/data";
import { data } from "@/lib/data";
import { usd, usdCompact } from "@/lib/format";
import { Scale, Check, Close, Coins } from "@/components/ui/icons";

export default async function DisputesPage() {
  const disputes = await data.listDisputes();
  const open = disputes.filter((d) => d.status === "OPEN");
  const resolved = disputes.filter((d) => d.status !== "OPEN");
  const totalSlashed = disputes.reduce((s, d) => s + (d.slashed ?? 0), 0);
  const upheld = disputes.filter((d) => d.status === "UPHELD").length;

  return (
    <div>
      <PageHeader
        title="Disputes"
        subtitle="Challenges against validator attestations, decided by a one-pool-one-vote jury."
        crumbs={[{ label: "Explore", href: "/" }, { label: "Disputes" }]}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <Stat label="Open disputes" value={String(open.length)} icon={<Scale className="h-4 w-4" />} sub="in voting" />
        </Card>
        <Card className="p-5">
          <Stat label="Upheld" value={String(upheld)} icon={<Close className="h-4 w-4" />} sub="attestation invalid" />
        </Card>
        <Card className="p-5">
          <Stat label="Rejected" value={String(disputes.filter((d) => d.status === "REJECTED").length)} icon={<Check className="h-4 w-4" />} sub="bond forfeited" />
        </Card>
        <Card className="p-5">
          <Stat label="Total slashed" value={usdCompact(totalSlashed)} icon={<Coins className="h-4 w-4" />} sub="to compensation pools" />
        </Card>
      </div>

      {/* Mechanics explainer */}
      <Card className="mb-6 p-5">
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs font-medium text-muted">Challenger bond</div>
            <div className="tnum mt-0.5 text-lg font-semibold text-foreground">{usd(protocolConfig.challengerBond)}</div>
            <p className="mt-1 text-xs text-muted">Forfeited if the dispute is rejected; refunded with a bounty if upheld.</p>
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Jury quorum & threshold</div>
            <div className="tnum mt-0.5 text-lg font-semibold text-foreground">
              {protocolConfig.juryQuorum} votes · {protocolConfig.juryThresholdBps / 100}%
            </div>
            <p className="mt-1 text-xs text-muted">Distinct staked pools above the {usdCompact(protocolConfig.juryMinStake)} floor, target excluded.</p>
          </div>
          <div>
            <div className="text-xs font-medium text-muted">Compensation grace</div>
            <div className="tnum mt-0.5 text-lg font-semibold text-foreground">
              {protocolConfig.compensationGraceMs / 86_400_000} days
            </div>
            <p className="mt-1 text-xs text-muted">Window for wrapped holders to unwrap before slashed funds sweep into the index.</p>
          </div>
        </div>
      </Card>

      {open.length > 0 && (
        <section className="mb-8">
          <SectionHeader title="Open disputes" subtitle="Live jury voting in progress" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {open.map((d) => (
              <DisputeCard key={d.id} dispute={d} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeader title="Resolved" subtitle="Historical verdicts" />
        <Paginated pageSize={10} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {resolved.map((d) => (
            <DisputeCard key={d.id} dispute={d} />
          ))}
        </Paginated>
      </section>
    </div>
  );
}
