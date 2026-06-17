"use client";

import { ActionButton } from "./ActionButton";
import { markApplied } from "@/lib/tx/optimistic";

/**
 * "Claim all" yield from the connected account's deeds (`accumulator::claim_rewards`).
 * In the mock this is a single aggregate claim; the live path issues one call per
 * accumulator. Routes to the primary position for follow-up.
 *
 * On success it marks every claimed position applied (`claim:<assetId>`), so the
 * per-holding Claim buttons collapse and the "yield ready" bell alerts clear — the
 * optimistic reconciliation, consistent across pages.
 */
export function ClaimAllAction({
  total,
  positions,
  assetIds,
  primaryAssetId,
  primaryAssetName,
}: {
  total: number;
  positions: number;
  assetIds: string[];
  primaryAssetId: string;
  primaryAssetName: string;
}) {
  return (
    <ActionButton
      tone="positive"
      label="Claim all"
      appliedLabel="Yield claimed"
      onSuccess={() => markApplied(...assetIds.map((id) => `claim:${id}`))}
      getIntent={() => ({
        kind: "claim_rewards",
        assetId: primaryAssetId,
        assetName: positions > 1 ? `${positions} positions` : primaryAssetName,
        amount: total,
      })}
    />
  );
}
