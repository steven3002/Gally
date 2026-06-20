"use client";

// DEV-M1 polish — a persistent "Get test USDC" button in the topbar (Devnet, connected
// wallet). The first-run modal only appears for brand-new wallets; this makes claiming
// available ANY time, so a user can always top up to interact with the dApp.

import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { ClaimTokensModal } from "./ClaimTokensModal";
import { Coins } from "@/components/ui/icons";

export function ClaimTokensButton() {
  const account = useCurrentAccount();
  const [open, setOpen] = useState(false);
  if (!account) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-tour="claim"
        title="Claim free Devnet USDC"
        className="hidden items-center gap-1.5 rounded-xl border border-warning/40 bg-warning-soft px-2.5 py-2 text-[11px] font-bold text-warning transition-colors hover:bg-warning/15 sm:flex"
      >
        <Coins className="h-4 w-4" /> Get test USDC
      </button>
      {open && <ClaimTokensModal onClose={() => setOpen(false)} />}
    </>
  );
}
