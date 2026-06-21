"use client";

import { ActionButton } from "./ActionButton";
import { Coins } from "@/components/ui/icons";

/**
 * Contribute to a FUNDING asset (`asset::contribute_capital`). Client wrapper so
 * the non-serializable intent closure stays on the client side of the seam; the
 * server page passes only primitive props.
 *
 * This is the primary "Buy Shares" / invest affordance. It can render full-width
 * (`block`) for prominent placements (marketplace cards, asset hero); `label` keeps
 * the established verb unless a caller overrides it. `block`/`size`/`className`
 * forward to the button.
 */
export function ContributeAction({
  assetId,
  assetName,
  remaining,
  label,
  block,
  size,
  className,
}: {
  assetId: string;
  assetName: string;
  remaining: number;
  label?: string;
  block?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const def = Math.max(1, Math.min(1000, remaining));
  return (
    <ActionButton
      tone="primary"
      label={label}
      block={block}
      size={size}
      className={className}
      icon={<Coins className="h-4 w-4" />}
      amount={{ label: "Investment amount", max: remaining, min: 1, default: def, suffix: "USDC" }}
      getIntent={(amount) => ({ kind: "contribute", assetId, assetName, amount })}
    />
  );
}
