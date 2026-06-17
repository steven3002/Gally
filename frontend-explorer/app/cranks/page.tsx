import type { Metadata } from "next";
import Link from "next/link";
import { allCranks } from "@/lib/mock/cranks";
import { CrankPanel } from "@/components/tx/CrankPanel";
import { Card } from "@/components/ui/primitives";
import { ChevronRight, Wrench } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Maintenance · Gally Explorer",
  description: "Permissionless keeper operations across the protocol.",
};

/**
 * The keeper view (FE-M7.2): every permissionless crank across the protocol, the
 * runnable ones first. Cranks are not role-gated — any connected user may run one
 * once its on-chain precondition holds — so they live here as well as on each
 * subject's own page. Eligibility is derived from the live fixture state.
 */
export default function CranksPage() {
  const ops = allCranks();
  const eligible = ops.filter((o) => o.eligible);
  const pending = ops.filter((o) => !o.eligible);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Explore</Link>
        <ChevronRight className="h-3 w-3 text-muted-2" />
        <span className="text-muted-2">Maintenance</span>
      </nav>

      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-muted">
          <Wrench className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Maintenance</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Permissionless <strong>cranks</strong> keep the protocol live: anyone may call them once an
            on-chain precondition is met. Exit/keeper calls carry no pause gate. {eligible.length} runnable
            now · {pending.length} pending.
          </p>
        </div>
      </div>

      {eligible.length > 0 && (
        <CrankPanel
          ops={eligible}
          title="Runnable now"
          subtitle="The precondition is met — connect a wallet to run any of these."
          showSubject
        />
      )}

      {pending.length > 0 && (
        <CrankPanel
          ops={pending}
          title="Pending"
          subtitle="Not yet eligible — shown with the reason and, when time-gated, the unlock date."
          showSubject
        />
      )}

      {ops.length === 0 && (
        <Card className="p-10 text-center text-sm text-muted">
          No crank opportunities in the current protocol state.
        </Card>
      )}
    </div>
  );
}
