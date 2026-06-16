"use client";

import { useWallet } from "@/lib/wallet";
import { ActionButton } from "./ActionButton";

/**
 * Per-holding user actions on an address page (claim / wrap / unwrap / split).
 * Only rendered for the **connected owner** of the holding — you can't act on
 * someone else's deeds. Each button is shown only when its precondition holds, so
 * read-only holdings stay clean.
 */
export function HoldingActions({
  owner,
  assetId,
  assetName,
  tokenSymbol,
  shareCount,
  wrapped,
  pendingYield,
  frozen,
}: {
  owner: string;
  assetId: string;
  assetName: string;
  tokenSymbol?: string;
  shareCount: number;
  wrapped: number;
  pendingYield: number;
  frozen: boolean;
}) {
  const { connected, address } = useWallet();
  if (!connected || address !== owner) return null;

  const sym = tokenSymbol ?? "tokens";
  const canClaim = pendingYield > 0;
  const canWrap = shareCount > 0 && !frozen;
  const canUnwrap = wrapped > 0;
  const canSplit = shareCount > 1;
  if (!canClaim && !canWrap && !canUnwrap && !canSplit) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2/40 px-4 py-3 sm:px-5">
      {canClaim && (
        <ActionButton
          size="sm"
          tone="positive"
          label="Claim yield"
          getIntent={() => ({ kind: "claim_rewards", assetId, assetName, amount: pendingYield })}
        />
      )}
      {canWrap && (
        <ActionButton
          size="sm"
          variant="ghost"
          label="Wrap"
          amount={{ label: `Wrap deeds into ${sym}`, max: shareCount, default: shareCount, suffix: "deeds" }}
          getIntent={(amount) => ({ kind: "wrap", assetId, assetName, amount, tokenSymbol })}
        />
      )}
      {canUnwrap && (
        <ActionButton
          size="sm"
          variant="ghost"
          label="Unwrap"
          amount={{ label: `Unwrap ${sym} to deeds`, max: wrapped, default: wrapped, suffix: sym }}
          getIntent={(amount) => ({ kind: "unwrap", assetId, assetName, amount, tokenSymbol })}
        />
      )}
      {canSplit && (
        <ActionButton
          size="sm"
          variant="ghost"
          label="Split"
          amount={{ label: "Split off deeds", max: shareCount - 1, default: 1, suffix: "deeds" }}
          getIntent={(amount) => ({ kind: "split", assetId, assetName, amount })}
        />
      )}
    </div>
  );
}
