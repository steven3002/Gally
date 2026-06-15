"use client";

import { ActionButton } from "./ActionButton";
import { Coins } from "@/components/ui/icons";

/**
 * Contribute to a FUNDING asset (`asset::contribute_capital`). Client wrapper so
 * the non-serializable intent closure stays on the client side of the seam; the
 * server page passes only primitive props.
 */
export function ContributeAction({
  assetId,
  assetName,
  remaining,
}: {
  assetId: string;
  assetName: string;
  remaining: number;
}) {
  const def = Math.max(1, Math.min(1000, remaining));
  return (
    <ActionButton
      tone="primary"
      icon={<Coins className="h-4 w-4" />}
      amount={{ label: "Contribution amount", max: remaining, min: 1, default: def, suffix: "USDC" }}
      getIntent={(amount) => ({ kind: "contribute", assetId, assetName, amount })}
    />
  );
}
