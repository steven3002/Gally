// FE-M8a — The data-access seam (interface).
//
// `app/`+`components/` consume `lib/types.ts` shapes through THIS interface; the
// origin (mock selectors vs. the live BI-M8 indexer) is chosen by env behind it.
// Async by construction so the live path can `fetch`; the mock path resolves
// instantly (offline build stays green). The connected-wallet `Position` tier is
// deliberately NOT here — that is wallet-RPC, owned by FE-M8b.

import type {
  Asset,
  Category,
  Dispute,
  GovParamChange,
  HolderEntry,
  Holding,
  ObjectRef,
  ProtocolEvent,
  TxRow,
  Validator,
  WalrusDoc,
} from "@/lib/types";
import type { RankedHolder } from "@/lib/mock/holders";
import type { Solvency } from "@/lib/mock/health";
import type { CrankOp } from "@/lib/mock/cranks";
import type { SearchResult } from "@/lib/mock/registry";

export type SourceKind = "mock" | "live";

/** Protocol-wide rollups for the home hero + KPI strip + sidebar. */
export interface ProtocolStatsDTO {
  tvl: number;
  totalRaised: number;
  totalYieldDistributed: number;
  activeAssets: number;
  totalAssets: number;
  validators: number;
  totalValidatorStake: number;
  avgApy: number;
  openDisputes: number;
  resolvedDisputes: number;
  inFunding: number;
  fundingGoalOpen: number;
  fundingRaisedOpen: number;
  contributors: number;
  tvlSpark: number[];
}

export interface CategoryStatDTO {
  category: Category;
  count: number;
  raised: number;
  avgApy: number;
}

export interface HoldersResult {
  entries: HolderEntry[];
  totalMinted: number;
}

export interface GovernanceResult {
  history: GovParamChange[];
  paused: boolean;
  /** Current ProtocolConfig params (object-proxy, Tier 2) — name→display value. */
  config: Record<string, string>;
}

export interface AddressResult {
  address: string;
  roles: string[];
  holdings: Holding[];
}

export interface HealthResult {
  ok: boolean; // indexer reachable
  stale: boolean; // lagging the chain tip past threshold
  detail?: string;
}

export interface DataSource {
  readonly kind: SourceKind;
  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | null>;
  listValidators(): Promise<Validator[]>;
  getValidator(poolId: string): Promise<Validator | null>;
  listDisputes(): Promise<Dispute[]>;
  getDispute(id: string): Promise<Dispute | null>;
  getHolders(assetId: string): Promise<HoldersResult>;
  recentEvents(limit?: number): Promise<ProtocolEvent[]>;
  eventsForAsset(assetId: string, limit?: number): Promise<ProtocolEvent[]>;
  getGovernance(): Promise<GovernanceResult>;
  getTx(digest: string): Promise<TxRow | null>;
  getAddress(address: string): Promise<AddressResult>;
  health(): Promise<HealthResult>;

  // --- aggregates / derived (FE-M8a) ---
  /** Protocol-wide rollups (home + sidebar). */
  getProtocolStats(): Promise<ProtocolStatsDTO>;
  /** Per-category counts/raised for the "browse by sector" grid. */
  getCategoryStats(): Promise<CategoryStatDTO[]>;
  /** The asset owning a given accumulator id (the `/tokens/:accId` page). */
  getAssetByAccId(accId: string): Promise<Asset | null>;
  /** Open + resolved disputes scoped to one asset. */
  disputesForAsset(assetId: string): Promise<Dispute[]>;
  /** Ranked holder distribution (deeds+wrapped, % of supply) for an asset. */
  holderDistribution(assetId: string): Promise<RankedHolder[]>;
  /** Reward-pool solvency vs. owed yield for an asset (§15.4 / I-M2). */
  getSolvency(assetId: string): Promise<Solvency>;
  /** Every permissionless crank opportunity across the protocol (keeper view). */
  allCranks(): Promise<CrankOp[]>;
  /** Resolve any id to its canonical explorer route (the `/objects/:id` brain). */
  resolveObject(id: string): Promise<ObjectRef | null>;
  /** Global search across every entity kind (⌘K + `/search`). */
  searchAll(query: string, limit?: number): Promise<SearchResult[]>;
  /** Legal-attestation documents for an asset (Tier 2 object-proxy dynamic field). */
  getLegalDocs(assetId: string): Promise<WalrusDoc[]>;
  /** Recent on-chain activity attributed to an address (address/validator pages). */
  addressActivity(address: string, limit?: number): Promise<ProtocolEvent[]>;
}
