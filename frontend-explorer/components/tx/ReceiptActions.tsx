"use client";

import type { AssetState } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { ActionButton } from "./ActionButton";

/**
 * Actions on a soulbound `ContributionReceipt`: claim deeds once the raise
 * finalized (`asset::claim_shares`), or refund if it failed
 * (`asset::refund_contribution`, an exit — no pause gate).
 */
export function ReceiptActions({
  assetId,
  assetName,
  amount,
  state,
}: {
  assetId: string;
  assetName: string;
  amount: number;
  state: AssetState;
}) {
  const { connected } = useWallet();
  if (!connected) return null;

  if (state === "FAILED") {
    return (
      <ActionButton
        size="sm"
        tone="warning"
        label="Sell Shares"
        getIntent={() => ({ kind: "refund", assetId, assetName, amount })}
      />
    );
  }
  // Can't convert to deeds while still funding / cancelled.
  if (state === "FUNDING" || state === "CANCELLED") return null;

  return (
    <ActionButton
      size="sm"
      tone="positive"
      label="Claim deeds"
      getIntent={() => ({ kind: "claim_shares", assetId, assetName, amount })}
    />
  );
}
