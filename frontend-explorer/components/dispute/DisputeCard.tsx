import Link from "next/link";
import type { Dispute } from "@/lib/types";
import { cn, relTime, usd } from "@/lib/format";
import { evidenceOf } from "@/lib/mock/documents";
import { Card } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/primitives";
import { DisputeStatusPill } from "@/components/ui/bits";
import { IdLink } from "@/components/ui/IdLink";
import { WalrusDoc } from "@/components/ui/WalrusDoc";
import { Scale, Clock, Check, Close } from "@/components/ui/icons";

export function VoteBar({ dispute }: { dispute: Dispute }) {
  const total = dispute.votesGuilty + dispute.votesInnocent;
  const guiltyPct = total ? (dispute.votesGuilty / total) * 100 : 0;
  const quorumMet = total >= dispute.quorum;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-danger">
          <Close className="h-3.5 w-3.5" /> Guilty {dispute.votesGuilty}
        </span>
        <span className="flex items-center gap-1.5 font-medium text-positive">
          Innocent {dispute.votesInnocent} <Check className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="bg-danger" style={{ width: `${guiltyPct}%` }} />
        <div className="bg-positive" style={{ width: `${100 - guiltyPct}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
        <span className="tnum">
          {total}/{dispute.quorum} quorum
        </span>
        <span className={cn("font-medium", quorumMet ? "text-positive" : "text-muted")}>
          {quorumMet ? "Quorum reached" : `${dispute.quorum - total} more needed`}
        </span>
      </div>
    </div>
  );
}

export function DisputeCard({ dispute }: { dispute: Dispute }) {
  const open = dispute.status === "OPEN";
  const evidence = evidenceOf(dispute.id);
  return (
    <Card className={cn("p-5", open && "border-warning/30")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <Avatar seed={dispute.targetPoolId} label={dispute.targetValidatorName} size={20} rounded="rounded-md" />
              <Link href={`/validators/${dispute.targetPoolId}`} className="text-sm font-semibold text-foreground hover:text-primary">
                {dispute.targetValidatorName}
              </Link>
            </div>
            <Link
              href={`/assets/${dispute.assetId}`}
              className="text-xs text-primary hover:underline"
            >
              {dispute.assetName}
            </Link>
          </div>
        </div>
        <DisputeStatusPill status={dispute.status} />
      </div>

      {/* On-chain evidence is primary; the stated claim is a secondary off-chain label. */}
      {evidence && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <WalrusDoc doc={evidence} compact />
        </div>
      )}
      <p className="mt-2 text-xs text-muted-2">
        <span className="font-medium text-muted">Stated claim:</span> {dispute.reason}
      </p>

      <div className="mt-4">
        <VoteBar dispute={dispute} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div>
          <div className="text-muted-2">Challenger bond</div>
          <div className="tnum mt-0.5 font-semibold text-foreground">{usd(dispute.bond)}</div>
        </div>
        <div>
          <div className="text-muted-2">{open ? "Voting closes" : "Resolved"}</div>
          <div
            className={cn(
              "mt-0.5 flex items-center gap-1 font-semibold",
              open ? "text-warning" : "text-foreground",
            )}
          >
            {open && <Clock className="h-3.5 w-3.5" />}
            {relTime(dispute.votingDeadlineMs)}
          </div>
        </div>
        {dispute.status === "UPHELD" && (
          <>
            <div>
              <div className="text-muted-2">Stake slashed</div>
              <div className="tnum mt-0.5 font-semibold text-danger">{usd(dispute.slashed ?? 0)}</div>
            </div>
            <div>
              <div className="text-muted-2">Challenger bounty</div>
              <div className="tnum mt-0.5 font-semibold text-positive">{usd(dispute.bounty ?? 0)}</div>
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-2">
        <span className="flex items-center gap-1">Challenger <IdLink id={dispute.challenger} /></span>
        <span className="flex items-center gap-1">Dispute <IdLink id={dispute.id} /></span>
        <Link href={`/disputes/${dispute.id}`} className="ml-auto font-medium text-primary hover:underline">
          View dispute →
        </Link>
      </div>
    </Card>
  );
}
