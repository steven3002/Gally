"use client";

// DEV-M1 polish — the connected wallet's live USDC balance.
//
// Reads `getBalance(USDC_TYPE)` over RPC (the `usdc` package coin — the Devnet proxy,
// Circle's on mainnet). USDC is 6-decimal, so μ→USDC is /1e6. Polls so a claim/contribute
// reflects without a manual refresh. Returns null when disconnected / unconfigured.

import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { USDC_TYPE } from "@/lib/tx/config";
import { Coins } from "@/components/ui/icons";

const MICRO = 1_000_000;

/** Human USDC balance of the connected wallet (0 while loading / disconnected). */
export function useUsdcBalance(): { usdc: number; isLoading: boolean; refetch: () => void } {
  const account = useCurrentAccount();
  const { data, isLoading, refetch } = useSuiClientQuery(
    "getBalance",
    { owner: account?.address ?? "", coinType: USDC_TYPE },
    { enabled: !!account && !!USDC_TYPE, refetchInterval: 8000 },
  );
  const usdc = data ? Number(BigInt(data.totalBalance)) / MICRO : 0;
  return { usdc, isLoading, refetch: () => void refetch() };
}

/** Compact human USDC (e.g. `1,250` / `1.25K` / `25K`). */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1e3).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 0 : 2 });
}

/**
 * Topbar pill showing the wallet's USDC balance. Compact on mobile (number only),
 * with the "USDC" ticker on ≥sm. Tappable target stays small so the topbar fits 375px.
 */
export function UsdcBalancePill() {
  const account = useCurrentAccount();
  const { usdc, isLoading } = useUsdcBalance();
  if (!account || !USDC_TYPE) return null;

  return (
    <span
      title={`Wallet balance: ${usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`}
      className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-2 text-[11px] font-bold text-foreground sm:px-2.5"
      data-tour="balance"
    >
      <Coins className="h-3.5 w-3.5 text-positive" />
      <span className="tnum">{isLoading ? "…" : fmt(usdc)}</span>
      <span className="hidden text-muted-2 sm:inline">USDC</span>
    </span>
  );
}
