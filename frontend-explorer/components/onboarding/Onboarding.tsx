"use client";

// DEV-M1 — Devnet onboarding orchestrator. Mounted once (live mode) inside the wallet
// providers. On a first-time connect it offers: (1) claim Devnet test tokens, then
// (2) an optional guided product tour. Re-entrant flow is remembered per wallet so it
// never nags. The DevnetBanner is rendered separately at the very top of the shell.

import { useCallback, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useFirstTimeUser } from "@/lib/onboarding/useFirstTimeUser";
import { ClaimTokensModal } from "./ClaimTokensModal";
import { TourProvider, useTour, type TourStep } from "./Tour";
import { Compass } from "@/components/ui/icons";

const TOUR: TourStep[] = [
  { anchor: "", title: "Welcome to Gally", body: "A 30-second tour of the essentials. You can Skip or Free explore at any time." },
  { anchor: "marketplace", title: "The Asset Marketplace", body: "Browse vetted real-world asset raises — housing, machinery, trade finance — and invest your Devnet USDC in one." },
  { anchor: "portfolio", title: "Your Portfolio", body: "Track your GallyShare deeds, wrapped tokens and claimable yield — read live from your connected wallet." },
  { anchor: "cranks", title: "Keeper Cranks", body: "Permissionless maintenance: anyone can run cranks (rollover, compensation sweeps, closures) to keep the protocol healthy." },
];

const seenKey = (addr: string) => `gally-onboarded-${addr}`;

export function Onboarding() {
  return (
    <TourProvider>
      <OnboardingFlow />
    </TourProvider>
  );
}

type Phase = "idle" | "claim" | "tour-prompt";

function OnboardingFlow() {
  const account = useCurrentAccount();
  const { firstTime, refetch } = useFirstTimeUser();
  const { start } = useTour();
  const [phase, setPhase] = useState<Phase>("idle");

  const addr = account?.address ?? "";
  const alreadyOnboarded = useCallback(() => {
    if (!addr) return true;
    try {
      return localStorage.getItem(seenKey(addr)) === "1";
    } catch {
      return false;
    }
  }, [addr]);
  const markOnboarded = useCallback(() => {
    try {
      if (addr) localStorage.setItem(seenKey(addr), "1");
    } catch {}
  }, [addr]);

  // First-time connect → kick off the claim step (once per wallet). Render-time guard
  // (the React-recommended alternative to setState-in-effect; mirrors AppShell), keyed on
  // the address so switching to a different fresh wallet re-triggers.
  const [triggeredAddr, setTriggeredAddr] = useState<string | null>(null);
  if (firstTime && triggeredAddr !== addr && phase === "idle" && !alreadyOnboarded()) {
    setTriggeredAddr(addr);
    setPhase("claim");
  }

  const startTour = useCallback(() => {
    markOnboarded();
    setPhase("idle");
    // Defer so the prompt unmounts before the spotlight measures.
    setTimeout(() => start(TOUR), 50);
  }, [markOnboarded, start]);

  if (phase === "claim") {
    return (
      <ClaimTokensModal
        onClaimed={refetch}
        onClose={() => setPhase("tour-prompt")}
      />
    );
  }

  if (phase === "tour-prompt") {
    return (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(2,6,23,0.6)] p-4 backdrop-blur-sm animate-[gally-rise_160ms_ease-out]"
        role="dialog"
        aria-modal="true"
        onClick={() => {
          markOnboarded();
          setPhase("idle");
        }}
      >
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-[var(--shadow-lg)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Compass className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-foreground">Want a quick guided tour?</h2>
          <p className="mt-1 text-sm text-muted">We&apos;ll point out the Marketplace, your Portfolio and the keeper Cranks in about 30 seconds.</p>
          <div className="mt-5 flex flex-col gap-2">
            <button onClick={startTour} className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-transform hover:scale-[1.01]">
              Show me around
            </button>
            <button
              onClick={() => {
                markOnboarded();
                setPhase("idle");
              }}
              className="w-full rounded-xl px-4 py-2 text-sm font-medium text-muted-2 transition-colors hover:text-foreground"
            >
              No thanks, I&apos;ll explore
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
