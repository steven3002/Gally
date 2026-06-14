// Domain types for the Gally Explorer.
// These mirror the on-chain object inventory (protocol_flow.md §3) and the
// event catalog (§18). The explorer is a pure observer — every shape here is
// something it would reconstruct from events + object reads.

/** Asset lifecycle states — protocol_flow.md §4. */
export type AssetState =
  | "PENDING_VOUCH"
  | "FUNDING"
  | "FUNDED"
  | "EXECUTING"
  | "OPERATIONAL"
  | "DEFAULTED"
  | "COMPENSATING"
  | "CLOSED"
  | "FAILED"
  | "CANCELLED";

export type Category =
  | "Housing"
  | "Machinery"
  | "Trade Finance"
  | "Agriculture"
  | "Energy"
  | "Infrastructure";

/** A funding tranche on the Asset (§3.5 `Tranche`). */
export interface Tranche {
  index: number;
  amount: number; // USDC
  description: string;
  deadlineMs: number;
  released: boolean;
  approvedBy?: string; // validator address
  proofBlobId?: string;
  proofSha256?: string;
}

/** Per-point sample for the index/APY and raise time-series. */
export interface Point {
  t: number; // ms timestamp
  v: number;
}

/** The GlobalYieldAccumulator<T> projection (§3.9). */
export interface Accumulator {
  id: string;
  tokenSymbol: string; // Coin<T> symbol, 6 decimals
  cumulativeIndex: number; // scaled human value (USDC of yield per share, lifetime)
  totalMintedShares: number;
  totalWrappedShares: number;
  rewardPool: number;
  rolloverReserve: number;
  compensationPool: number;
  wrappingFrozen: boolean;
  lifetimeInvestorRevenue: number;
  apy: number; // trailing effective APY, %
}

export interface Asset {
  id: string;
  name: string;
  ticker: string; // short code shown in tables/cards
  entity: string; // entity address
  entityName: string;
  category: Category;
  state: AssetState;
  blurb: string;
  location: string;

  // capital formation
  fundingGoal: number; // USDC == total share supply
  raised: number;
  fundingDeadlineMs: number;
  createdAtMs: number;

  // execution
  tranches: Tranche[];
  entityCollateral: number;
  revenueSplitBps: number;

  // operation
  accumulator?: Accumulator;
  isTermFinancing: boolean;
  returnTarget: number;

  // safety
  disputed: boolean;
  validatorPoolId: string;

  // explorer-only derived series (reconstructed from events)
  raiseSeries: Point[]; // raised_after over time
  indexSeries: Point[]; // cumulative_yield_index over time
  wrapSeries: Point[]; // total_wrapped_after over time
  spark: number[]; // tiny series for cards
  contributors: number;
  holders: number;
}

export interface Validator {
  poolId: string;
  address: string;
  name: string;
  status: "ACTIVE" | "FROZEN" | "SLASHED";
  stake: number; // total USDC collateral
  locked: number; // committed against active vouches
  activeVouches: number;
  registeredAtMs: number;
  // track record
  assetsVouched: number;
  milestonesApproved: number;
  disputesAgainst: number;
  disputesUpheld: number;
  reputation: number; // 0-100 derived score
  stakeSpark: number[];
}

export type DisputeStatus = "OPEN" | "UPHELD" | "REJECTED" | "EXPIRED";

export interface Dispute {
  id: string;
  assetId: string;
  assetName: string;
  targetPoolId: string;
  targetValidatorName: string;
  challenger: string;
  bond: number;
  status: DisputeStatus;
  votesGuilty: number;
  votesInnocent: number;
  quorum: number;
  votingDeadlineMs: number;
  openedAtMs: number;
  reason: string;
  slashed?: number;
  bounty?: number;
}

/** Event types — §18.3 catalog (logical names, no `Event` suffix). */
export type EventType =
  | "AssetCreated"
  | "AssetVouched"
  | "AssetStateChanged"
  | "MilestoneProofSubmitted"
  | "MilestoneApproved"
  | "TrancheReleased"
  | "AssetOperational"
  | "EntityDefaulted"
  | "AssetClosed"
  | "CapitalContributed"
  | "ContributionRefunded"
  | "SharesClaimed"
  | "SharesWrapped"
  | "SharesUnwrapped"
  | "YieldClaimed"
  | "ShareRedeemed"
  | "RaiseFinalized"
  | "RaiseAborted"
  | "RevenueDeposited"
  | "RolloverSwept"
  | "CompensationSwept"
  | "ValidatorRegistered"
  | "StakeAdded"
  | "DisputeOpened"
  | "JurorVoted"
  | "DisputeResolved";

export type EventFeed =
  | "lifecycle"
  | "position"
  | "revenue"
  | "validator"
  | "dispute"
  | "governance";

export interface ProtocolEvent {
  id: string;
  type: EventType;
  feed: EventFeed;
  tsMs: number;
  assetId?: string;
  assetName?: string;
  actor?: string; // economically relevant address
  actorRole?: "investor" | "entity" | "validator" | "challenger" | "admin";
  amount?: number; // USDC where relevant
  txDigest: string;
  // human summary fields
  summary: string;
  meta?: string;
}

/**
 * Demo portfolio position (reconstructed per §18.4 query #2).
 *
 * A holding is two *distinct* on-chain things in the wallet:
 *  - `deeds`   — GallyShare owned objects. These accrue yield via the lazy index
 *                and are the ONLY thing `claim_rewards` can be called against (§11).
 *  - `wrapped` — a vanilla `Coin<T>` balance. Composable/tradeable, but earns
 *                ZERO yield while wrapped, by construction (D2/D5, wrap theorem §12).
 * 1 share == 1 USDC of principal, so both sub-balances are valued at par.
 */
export interface Position {
  assetId: string;
  assetName: string;
  ticker: string;
  tokenSymbol: string; // wrapped Coin<T> symbol, e.g. "gVCC"
  category: Category;
  state: AssetState;
  deeds: number; // GallyShare share_count held UNWRAPPED — yield-bearing
  wrapped: number; // Coin<T> balance held — earns NO yield until unwrapped
  costBasis: number; // USDC originally contributed / paid
  yieldEarned: number; // lifetime yield claimed (against deeds)
  yieldClaimable: number; // accrued, unclaimed yield on the deeds only
  apy: number; // asset effective APY (applies to deeds)
  spark: number[];
}

export interface Watch {
  assetId: string;
}
