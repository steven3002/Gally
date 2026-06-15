"use client";

import { ActionButton } from "./ActionButton";

/**
 * "Claim all" yield from the connected account's deeds (`accumulator::claim_rewards`).
 * In the mock this is a single aggregate claim; the live path issues one call per
 * accumulator. Routes to the primary position for follow-up.
 */
export function ClaimAllAction({
  total,
  positions,
  primaryAssetId,
  primaryAssetName,
}: {
  total: number;
  positions: number;
  primaryAssetId: string;
  primaryAssetName: string;
}) {
  return (
    <ActionButton
      tone="positive"
      label="Claim all"
      getIntent={() => ({
        kind: "claim_rewards",
        assetId: primaryAssetId,
        assetName: positions > 1 ? `${positions} positions` : primaryAssetName,
        amount: total,
      })}
    />
  );
}
