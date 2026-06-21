"use client";

import { ActionButton } from "./ActionButton";
import { useUsdcBalance } from "./UsdcBalance";
import { isLive } from "@/lib/data";
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
 *
 * `fundingGoal` is USDC and equals total share supply (spec §3), so 1 USDC = 1 share:
 * the modal surfaces a $1 share price, remaining shares, and (live mode) the connected
 * wallet's USDC balance + the most they can afford.
 */

// USDC is 6-decimal on-chain; the dapp-kit balance hook only resolves under the live
// provider, so gate the call by the build-time `isLive` constant (same pattern as
// `useWallet`). Mock mode has no real balance → the % chips/Max size to the raise.
const useSpendableUsdc: () => number | undefined = isLive
  ? function useSpendableLive() {
      const { usdc, isLoading } = useUsdcBalance();
      return isLoading ? undefined : usdc;
    }
  : function useSpendableMock() {
      return undefined;
    };

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
  const balance = useSpendableUsdc();
  const def = Math.max(1, Math.min(1000, remaining));
  return (
    <ActionButton
      tone="primary"
      label={label}
      block={block}
      size={size}
      className={className}
      icon={<Coins className="h-4 w-4" />}
      amount={{
        label: "Amount to invest",
        max: remaining,
        min: 1,
        default: def,
        suffix: "USDC",
        unit: "shares",
        unitPrice: 1,
        availableLabel: "Remaining in raise",
        balance,
      }}
      getIntent={(amount) => ({ kind: "contribute", assetId, assetName, amount })}
    />
  );
}
