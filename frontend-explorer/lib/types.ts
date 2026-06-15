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
  compensationUnlockMs?: number; // grace deadline: unwrap before this to keep restitution (§13, D5)
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
  coverageLocked: number; // real USDC coverage the validator locked at vouch (§3.5); 0 if unvouched

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
  | "StakeWithdrawn"
  | "ValidatorStatusChanged"
  | "DisputeOpened"
  | "JurorVoted"
  | "DisputeResolved"
  | "AssetCancelled"
  | "ProtocolInitialized"
  | "ProtocolParamChanged"
  | "ProtocolTreasuryChanged"
  | "EmergencyStopTriggered"
  | "ProtocolResumed";

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

/* ===========================================================================
 * Explorer graph types (FE-M1) — the persistent object/account model that
 * turns the dashboard into a navigable block-explorer.
 * ======================================================================== */

/** Every role an address can play in the protocol (§2 Actor Model). */
export type AccountRole =
  | "investor"
  | "entity"
  | "validator"
  | "challenger"
  | "admin"
  | "treasury";

/** Any address, resolved to a labelled account (the `/address/:addr` subject). */
export interface Account {
  address: string;
  label?: string; // display name when known (entity/validator name, "Treasury", …)
  roles: AccountRole[]; // every role this address plays
  known: boolean; // true = in the explicit roster; false = anonymous (auto-resolved)
}

/**
 * One holder's stake in one asset (a `GallyShare` deed position + any wrapped
 * `Coin<T>`), reconstructed per §18.4 query #2. `shareCount` = unwrapped deeds
 * (yield-bearing); `wrapped` = Coin<T> balance (no yield until unwrapped, D2/D5).
 */
export interface HolderEntry {
  address: string;
  shareCount: number; // deeds (unwrapped) — yield-bearing
  wrapped: number; // Coin<T> balance — earns no yield
  acquiredAtMs: number;
  yieldClaimedIndex: number; // personal index snapshot (scaled human value)
}

/** A holder entry joined to its asset context — powers address pages. */
export interface Holding extends HolderEntry {
  assetId: string;
  assetName: string;
  ticker: string;
  tokenSymbol?: string;
  category: Category;
  state: AssetState;
  apy: number;
  pendingYield: number; // claimable yield on the deeds only
}

export type DocKind = "legal" | "proof" | "evidence";

/**
 * Content-addressed off-chain document (`WalrusRef`, §3.5). The chain stores
 * only `blobId` + `sha256` + `attestedBy`; the bytes live on Walrus. The
 * sha256 pins CONTENT so a blob-swap is detectable (attack A13).
 */
export interface WalrusDoc {
  blobId: string;
  sha256: string;
  attestedBy: string; // address that signed/submitted it
  kind: DocKind;
  label: string;
  trancheIndex?: number; // set for milestone proofs
}

/** One `ProtocolParamChanged`/treasury/pause governance entry (event-only history, §18.3). */
export interface GovParamChange {
  name: string;
  oldValue: string;
  newValue: string;
  tsMs: number;
  txDigest: string;
}

/** Kinds the universal `/objects/:id` resolver can route to. */
export type ObjectKind =
  | "asset"
  | "token"
  | "validator"
  | "dispute"
  | "account"
  | "tx"
  | "config";

/** Resolution of any id to its canonical explorer route. */
export interface ObjectRef {
  id: string;
  kind: ObjectKind;
  route: string;
  label?: string;
}

/** A transaction = a group of events sharing one digest (atomic protocol call). */
export interface TxRow {
  digest: string;
  tsMs: number;
  events: ProtocolEvent[];
  kind: string; // the headline action (e.g. "finalize", "release_funding_tranche")
}
