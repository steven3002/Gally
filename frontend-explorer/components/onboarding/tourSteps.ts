// DEV-M1 — guided product tours.
//
// There is one OVERVIEW tour (nav-anchored, used for the first-run onboarding and the
// home page) plus a PER-PAGE tour for each major surface. The "Take tour" button picks
// the tour that matches the current route (`tourForPath`), so clicking it on an asset
// page explains the asset page, on the portfolio explains the portfolio, etc.
//
// Each `anchor` is a `data-tour` value spotlighted on screen; "" is a centered, anchorless
// step; an anchor that isn't on the page degrades gracefully to a centered card — so a
// tour still reads correctly even when an optional element (e.g. a conditional panel) is
// absent.

import type { TourStep } from "./Tour";

/** First-run + home/overview tour — spotlights the global navigation (always present). */
export const OVERVIEW_TOUR: TourStep[] = [
  { anchor: "", title: "Welcome to Gally", body: "A quick tour of the essentials — invest in real-world assets, earn yield, and help run the protocol. Skip or Free explore at any time." },
  { anchor: "network", title: "You're on Devnet", body: "This chip shows the live chain you're connected to. Devnet is a public test network — tokens here have no real value." },
  { anchor: "claim", title: "Get test USDC", body: "Tap here any time to claim free Devnet USDC from the faucet, so you always have funds to invest and transact." },
  { anchor: "marketplace", title: "The Asset Marketplace", body: "Browse vetted real-world asset raises — housing, machinery, trade finance — and invest your USDC in one." },
  { anchor: "portfolio", title: "Your Portfolio", body: "Your GallyShare deeds, wrapped tokens and claimable yield — read live from your wallet. Actions reconcile against the chain in real time." },
  { anchor: "validators", title: "Validators", body: "Stake-backed attestors vouch project legals, approve milestones and sit on dispute juries — their stake is slashable if they're wrong." },
  { anchor: "governance", title: "Governance", body: "Every ProtocolConfig parameter — fees, the validator min-stake, jury quorum, dispute windows — read live from chain." },
  { anchor: "cranks", title: "Keeper Cranks", body: "Permissionless maintenance: anyone (you included) can run cranks — rollover, compensation sweeps, closures — to keep the protocol healthy." },
];

/** Back-compat alias used by the first-run onboarding prompt. */
export const TOUR = OVERVIEW_TOUR;

/** Asset detail page (`/assets/:id`). */
export const ASSET_TOUR: TourStep[] = [
  { anchor: "asset-header", title: "This asset", body: "The project's name, entity, sector and — crucially — its live lifecycle state. Everything on this page is reconstructed from on-chain events." },
  { anchor: "asset-lifecycle", title: "Lifecycle", body: "Every raise moves Listed → Funding → Funded → Executing → Operational → Closed (or Defaulted/Failed). This tracker shows exactly where it is." },
  { anchor: "asset-fund", title: "Fund / progress", body: "How much USDC has been raised toward the goal. While it's Funding you can contribute here — you'll receive a soulbound receipt that converts to deeds when the raise finalizes." },
  { anchor: "asset-tabs", title: "Drill in", body: "Switch between Overview, Tranches (milestone releases), Yield & revenue, the Holders ledger, and the full Activity feed for this asset." },
  { anchor: "asset-yield", title: "Yield engine", body: "The accumulator: cumulative USDC distributed per share, effective APY, reward-pool solvency and the wrap ratio. Deeds accrue yield; wrapped tokens don't." },
  { anchor: "asset-validator", title: "Validator attestation", body: "Which validator staked its USDC coverage to vouch this asset's legals — and the documents they pinned on-chain. Their stake is slashable in a dispute." },
];

/** Portfolio + any address page. */
export const PORTFOLIO_TOUR: TourStep[] = [
  { anchor: "pf-balance", title: "Spendable USDC", body: "Your live wallet USDC — what you have available to invest. Top up any time with Get test USDC in the top bar." },
  { anchor: "pf-summary", title: "Position summary", body: "Your holdings value, yield-bearing deeds, wrapped tokens (no yield until unwrapped), and claimable yield — all read directly from your wallet over RPC." },
  { anchor: "pf-holdings", title: "Holdings & actions", body: "Each position with its claim / wrap / unwrap / split actions. Actions are gated to you — you only see them on your own holdings." },
  { anchor: "pf-receipts", title: "Investment receipts", body: "Soulbound ContributionReceipts from raises you funded. Convert them to GallyShare deeds once the raise finalizes, or refund if it fails." },
  { anchor: "pf-activity", title: "Your activity", body: "Every protocol event where this wallet is the economic actor — contributions, claims, wraps, disputes." },
];

/** Asset marketplace list (`/assets`). */
export const MARKET_TOUR: TourStep[] = [
  { anchor: "market-controls", title: "Find a raise", body: "Search and filter every asset by sector and lifecycle state to find a project to back." },
  { anchor: "market-grid", title: "Asset cards", body: "Each card shows the raise's state, funding progress (while Funding) or effective APY (once Operational), and its sector. Click any card for the full asset page." },
  { anchor: "", title: "Invest in one click", body: "Open a Funding asset and contribute USDC — you'll get a receipt that becomes yield-bearing GallyShare deeds when the raise finalizes." },
];

/** Validators page (`/validators`). */
export const VALIDATORS_TOUR: TourStep[] = [
  { anchor: "val-stats", title: "Validator economics", body: "Total slashable USDC stake across all validators, how much is committed against live vouches, the active count, and the average reputation." },
  { anchor: "val-min", title: "Stake & coverage rules", body: "The live on-chain minimum validator stake and the share of each asset's funding goal a vouch locks as coverage." },
  { anchor: "val-list", title: "The validators", body: "Each attestor with its stake, live vouches, milestones approved and dispute record. Click through for the full track record." },
];

/** Governance page (`/governance`). */
export const GOVERNANCE_TOUR: TourStep[] = [
  { anchor: "gov-params", title: "Protocol parameters", body: "Every ProtocolConfig value — protocol fee, validator min-stake, jury quorum & threshold, dispute window, compensation grace — read live from the on-chain config object." },
  { anchor: "", title: "Pause & history", body: "Whether the protocol is paused (exit functions still work — claims and refunds never pause), plus the event-sourced history of every parameter change." },
];

/** Token / accumulator page (`/tokens/:accId`). */
export const TOKEN_TOUR: TourStep[] = [
  { anchor: "", title: "The entity token", body: "Each asset's accumulator mints a per-entity Coin<T>. This page shows its supply, the wrapped ratio, the cumulative yield index and the reward pool." },
  { anchor: "", title: "Wrap vs. unwrap", body: "Wrapping turns yield-bearing deeds into a composable Coin<T> that earns no yield; unwrapping restores deeds. Total Coin<T> supply always equals total wrapped shares." },
];

/** Dispute page (`/disputes/:id`). */
export const DISPUTES_TOUR: TourStep[] = [
  { anchor: "", title: "Disputes & slashing", body: "A challenger posts a bond to contest a validator's attestation; a stake-weighted jury votes within the dispute window." },
  { anchor: "", title: "Outcome", body: "If upheld, the validator's coverage is slashed and routed to restitution (deed holders only — wrapped holders must unwrap first); if rejected, the challenger forfeits the bond." },
];

/** Cranks / keeper page (`/cranks`). */
export const CRANKS_TOUR: TourStep[] = [
  { anchor: "", title: "Permissionless cranks", body: "Anyone — including you — can run protocol maintenance: yield rollover sweeps, compensation sweeps, raise finalization and closures." },
  { anchor: "cranks-list", title: "Eligible work", body: "Each crank shows whether its on-chain precondition is met right now. Run an eligible one to keep the protocol healthy (and exercise the live transaction path)." },
];

/** Pick the tour that matches the current route. */
export function tourForPath(pathname: string): TourStep[] {
  if (/^\/assets\/.+/.test(pathname)) return ASSET_TOUR;
  if (pathname === "/assets") return MARKET_TOUR;
  if (/^\/tokens\/.+/.test(pathname)) return TOKEN_TOUR;
  if (pathname.startsWith("/validators")) return VALIDATORS_TOUR;
  if (pathname.startsWith("/governance")) return GOVERNANCE_TOUR;
  if (pathname.startsWith("/disputes")) return DISPUTES_TOUR;
  if (pathname.startsWith("/cranks")) return CRANKS_TOUR;
  if (pathname === "/portfolio" || pathname.startsWith("/address/")) return PORTFOLIO_TOUR;
  return OVERVIEW_TOUR;
}
