"use client";

import { ActionButton } from "./ActionButton";
import { Scale } from "@/components/ui/icons";

/**
 * Raise a dispute against a validator's attestation (`dispute::initialize_dispute`).
 * Any user may challenge by posting the `challenger_bond` — refunded with a bounty
 * if upheld, forfeited if rejected. References the vouched asset under contest.
 */
export function DisputeAction({
  poolId,
  validatorName,
  assetId,
  bond,
}: {
  poolId: string;
  validatorName: string;
  assetId: string;
  bond: number;
}) {
  return (
    <ActionButton
      tone="danger"
      variant="ghost"
      icon={<Scale className="h-4 w-4" />}
      label="Raise dispute"
      getIntent={() => ({ kind: "raise_dispute", poolId, validatorName, assetId, bond })}
    />
  );
}
