"use client";

// DEV-M1 — "Claim Devnet Tokens" modal. A minimalist first-run step that calls the
// `gally_mock_faucet::claim` entry to fund a fresh wallet with test USDC so the user can
// immediately try the app. The PTB is built inline (claim returns a `Coin<USDC>`, which we
// transfer to the sender) — no protocol intent needed; this is onboarding infrastructure.

import { useCallback, useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { FAUCET_PACKAGE_ID, MOCK_FAUCET_ID } from "@/lib/tx/config";
import { Check, Coins, Close, Wallet } from "@/components/ui/icons";

type Phase = "idle" | "claiming" | "done" | "error";

export function ClaimTokensModal({ onClose, onClaimed }: { onClose: () => void; onClaimed?: () => void }) {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);

  const configured = !!FAUCET_PACKAGE_ID && !!MOCK_FAUCET_ID;

  const claim = useCallback(async () => {
    if (!account || !configured) return;
    setPhase("claiming");
    setError(null);
    try {
      const tx = new Transaction();
      // `claim(faucet: &mut MockFaucet): Coin<USDC>` — transfer the payout to the caller.
      const [coin] = tx.moveCall({
        target: `${FAUCET_PACKAGE_ID}::faucet::claim`,
        arguments: [tx.object(MOCK_FAUCET_ID)],
      });
      tx.transferObjects([coin], account.address);
      const res = await signAndExecute({ transaction: tx });
      setDigest(res.digest);
      setPhase("done");
      onClaimed?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Friendly mapping of the two faucet aborts (already-claimed / reservoir-empty).
      if (/EAlreadyClaimed|, 0\b/.test(msg)) setError("This wallet has already claimed its Devnet tokens.");
      else if (/EReservoirEmpty|, 1\b/.test(msg)) setError("The faucet is temporarily empty — try again shortly.");
      else if (/reject|cancel|denied/i.test(msg)) setError("Claim cancelled in your wallet.");
      else setError(msg.length > 140 ? msg.slice(0, 137) + "…" : msg);
      setPhase("error");
    }
  }, [account, configured, signAndExecute, onClaimed]);

  return (
    <Backdrop onClose={onClose}>
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-lg)]">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-md p-0.5 text-muted-2 transition-colors hover:text-foreground">
          <Close className="h-4 w-4" />
        </button>

        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          {phase === "done" ? <Check className="h-6 w-6" /> : <Coins className="h-6 w-6" />}
        </span>

        {phase === "done" ? (
          <>
            <h2 className="mt-4 text-lg font-bold text-foreground">You&apos;re funded 🎉</h2>
            <p className="mt-1 text-sm text-muted">
              Test USDC is now in your wallet. Head to the <strong>Asset Marketplace</strong> to invest, or open your
              <strong> Portfolio</strong> to track deeds and yield.
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-transform hover:scale-[1.01]"
            >
              Start exploring
            </button>
          </>
        ) : (
          <>
            <h2 className="mt-4 text-lg font-bold text-foreground">Welcome to Gally on Devnet</h2>
            <p className="mt-1 text-sm text-muted">
              This is a public <strong>test network</strong> — tokens have no real value. Claim free Devnet USDC to fund
              your wallet and try the full app: invest in real-world asset raises, earn yield, and run keeper cranks.
            </p>

            {phase === "error" && error && (
              <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>
            )}
            {!configured && (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                Faucet not configured (set <code>NEXT_PUBLIC_FAUCET_PACKAGE_ID</code> + <code>NEXT_PUBLIC_MOCK_FAUCET_ID</code>).
              </div>
            )}

            <button
              onClick={claim}
              disabled={!account || !configured || phase === "claiming"}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "claiming" ? (
                <>
                  <Spinner /> Claiming…
                </>
              ) : (
                <>
                  <Wallet className="h-4 w-4" /> Claim Devnet Tokens
                </>
              )}
            </button>
            <button onClick={onClose} className="mt-2 w-full text-center text-xs font-medium text-muted-2 transition-colors hover:text-foreground">
              Maybe later
            </button>
          </>
        )}
        {digest && <div className="mt-3 truncate text-center font-mono text-[10px] text-muted-2">tx {digest}</div>}
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-[rgba(2,6,23,0.6)] p-4 pt-20 backdrop-blur-sm animate-[gally-rise_160ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-primary/30 border-t-on-primary" />;
}
