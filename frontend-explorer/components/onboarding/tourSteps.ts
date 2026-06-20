// DEV-M1 — the guided product-tour steps, shared by BOTH the first-run onboarding prompt
// and the persistent "Take tour" button, so every entry point runs the identical tour.
// Each `anchor` is a `data-tour` value spotlighted on screen ("" = a centered, anchorless
// step); a missing anchor degrades to a centered card (graceful when disconnected).

import type { TourStep } from "./Tour";

export const TOUR: TourStep[] = [
  { anchor: "", title: "Welcome to Gally", body: "A quick tour of the essentials — invest in real-world assets, earn yield, and help run the protocol. Skip or Free explore at any time." },
  { anchor: "network", title: "You're on Devnet", body: "This chip shows the live chain you're connected to. Devnet is a public test network — tokens here have no real value." },
  { anchor: "claim", title: "Get test USDC", body: "Tap here any time to claim free Devnet USDC from the faucet, so you always have funds to invest and transact." },
  { anchor: "marketplace", title: "The Asset Marketplace", body: "Browse vetted real-world asset raises — housing, machinery, trade finance — and invest your USDC in one." },
  { anchor: "portfolio", title: "Your Portfolio", body: "Your GallyShare deeds, wrapped tokens and claimable yield — read live from your wallet. Actions reconcile against the chain in real time." },
  { anchor: "validators", title: "Validators", body: "Stake-backed attestors vouch project legals, approve milestones and sit on dispute juries — their stake is slashable if they're wrong." },
  { anchor: "governance", title: "Governance", body: "Every ProtocolConfig parameter — fees, the validator min-stake, jury quorum, dispute windows — read live from chain." },
  { anchor: "cranks", title: "Keeper Cranks", body: "Permissionless maintenance: anyone (you included) can run cranks — rollover, compensation sweeps, closures — to keep the protocol healthy." },
];
