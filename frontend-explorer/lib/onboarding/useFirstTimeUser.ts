"use client";

// DEV-M1 — first-time-user detection for the Devnet onboarding flow.
//
// A connected wallet is a "first-time user" when it holds **0 USDC** (queried against the
// Devnet `usdc` proxy package coin type) AND **0 GallyShare** deeds — i.e. it has never
// touched the protocol, so we offer it the faucet claim + the guided tour.

import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { USDC_TYPE } from "@/lib/tx/config";
import { useOwnedDeeds } from "@/lib/data/position";

export interface FirstTimeState {
  connected: boolean;
  isLoading: boolean;
  /** μUSDC balance of the connected wallet (the Devnet proxy USDC). */
  usdcBalance: bigint;
  /** Number of owned `GallyShare` deeds. */
  deedCount: number;
  /** True iff connected with 0 USDC and 0 deeds. */
  firstTime: boolean;
  refetch: () => void;
}

export function useFirstTimeUser(): FirstTimeState {
  const account = useCurrentAccount();
  const enabled = !!account && !!USDC_TYPE;

  const { data: bal, isLoading: balLoading, refetch: refetchBal } = useSuiClientQuery(
    "getBalance",
    { owner: account?.address ?? "", coinType: USDC_TYPE },
    { enabled },
  );
  const { deeds, isLoading: deedsLoading, refetch: refetchDeeds } = useOwnedDeeds();

  let usdcBalance = BigInt(0);
  try {
    usdcBalance = BigInt(bal?.totalBalance ?? "0");
  } catch {
    /* leave 0 */
  }
  const deedCount = deeds.length;
  const isLoading = enabled && (balLoading || deedsLoading);

  return {
    connected: !!account,
    isLoading,
    usdcBalance,
    deedCount,
    firstTime: !!account && !isLoading && usdcBalance === BigInt(0) && deedCount === 0,
    refetch: () => {
      refetchBal();
      refetchDeeds();
    },
  };
}
