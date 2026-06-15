import Link from "next/link";
import type { Validator } from "@/lib/types";
import { cn, pct, usd, usdCompact } from "@/lib/format";
import type { Tone } from "@/lib/format";
import { Avatar, ProgressBar } from "@/components/ui/primitives";
import { Pill } from "@/components/ui/bits";
import { RingGauge, Sparkline } from "@/components/ui/charts";
import { ChevronRight } from "@/components/ui/icons";

const STATUS_TONE: Record<Validator["status"], Tone> = {
  ACTIVE: "positive",
  FROZEN: "warning",
  SLASHED: "danger",
};

export function ValidatorStatusPill({ status }: { status: Validator["status"] }) {
  return (
    <Pill tone={STATUS_TONE[status]} dot={status !== "SLASHED"}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Pill>
  );
}

export function ValidatorCard({ validator: v }: { validator: Validator }) {
  const utilization = v.stake > 0 ? (v.locked / v.stake) * 100 : 0;
  const repColor =
    v.reputation >= 85 ? "var(--positive)" : v.reputation >= 60 ? "var(--warning)" : "var(--danger)";

  return (
    <Link
      href={`/validators/${v.poolId}`}
      className="group block rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-[var(--shadow-sm)] transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar seed={v.poolId} label={v.name} size={44} rounded="rounded-full" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{v.name}</h3>
            <div className="mt-1">
              <ValidatorStatusPill status={v.status} />
            </div>
          </div>
        </div>
        <RingGauge
          value={v.reputation}
          size={52}
          thickness={6}
          color={repColor}
          label={<span className="tnum text-xs font-bold">{v.reputation}</span>}
        />
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-[11px] font-medium text-muted">Total stake</div>
          <div className="tnum text-xl font-bold tracking-tight text-foreground">
            {usdCompact(v.stake)}
          </div>
        </div>
        <Sparkline data={v.stakeSpark} color={repColor} width={96} height={34} />
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span>Stake committed</span>
          <span className="tnum">
            {usd(v.locked)} ({pct(utilization, 0)})
          </span>
        </div>
        <ProgressBar value={utilization} tone={v.status === "SLASHED" ? "danger" : "info"} height="h-1.5" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
        <Mini label="Vouches" value={v.activeVouches} />
        <Mini label="Approvals" value={v.milestonesApproved} />
        <Mini label="Disputes" value={v.disputesAgainst} danger={v.disputesUpheld > 0} />
      </div>

      <div className="mt-3 flex items-center justify-end text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        View track record <ChevronRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

function Mini({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div>
      <div className={cn("tnum text-sm font-semibold", danger ? "text-danger" : "text-foreground")}>
        {value}
      </div>
      <div className="text-[10px] text-muted-2">{label}</div>
    </div>
  );
}
