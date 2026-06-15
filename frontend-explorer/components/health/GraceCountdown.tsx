import type { Grace } from "@/lib/mock/health";
import { relTime, shortDate } from "@/lib/format";
import { Clock, Lock } from "@/components/ui/icons";

/**
 * The compensation grace deadline (FE-M5, §13/D5). While `wrapping_frozen`,
 * wrapped holders must unwrap before `compensation_unlock_ms` or they forfeit the
 * slashed/seized restitution swept into the index. Shows the date + a live
 * relative countdown; tone is warning while open, neutral once elapsed.
 */
export function GraceCountdown({ grace, tokenSymbol }: { grace: Grace; tokenSymbol?: string }) {
  if (grace.active) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-warning">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="text-xs">
          <div className="font-semibold">
            Unwrap {tokenSymbol ?? "wrapped tokens"} before {shortDate(grace.unlockMs)} to keep your compensation
          </div>
          <div className="mt-0.5 text-warning/80">
            Compensation grace window closes {relTime(grace.unlockMs)}. After it, slashed/seized funds
            sweep into the index and only unwrapped deeds are eligible (§13).
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
      <Lock className="h-3.5 w-3.5" />
      Grace window closed {shortDate(grace.unlockMs)} — compensation has swept into the index.
    </div>
  );
}
