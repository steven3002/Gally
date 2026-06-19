// FE-M8a — Mock data source: wraps the existing `lib/mock/*` selectors behind the
// async `DataSource` interface. Returns the SAME objects the pages used directly, so
// `NEXT_PUBLIC_DATA_SOURCE=mock` (the default) is byte-identical to end-of-FE-M7.2 and
// the offline build + e2e stay green. The mock selectors are the source of record.

import {
  assets,
  assetById,
  assetByAccId,
  validators,
  validatorByPool,
  disputes,
  disputeById,
  disputesForAsset as mockDisputesForAsset,
  protocolConfig,
  protocolStats,
  categoryStats,
} from "@/lib/mock/data";
import { holdersOf, supplyOf, holdingsOf, holderDistribution } from "@/lib/mock/holders";
import { recentEvents as mockRecent, eventsForAsset as mockEventsForAsset, eventsForActor, txByDigest } from "@/lib/mock/activity";
import { paramHistory } from "@/lib/mock/governance";
import { accountByAddr } from "@/lib/mock/accounts";
import { solvencyOf } from "@/lib/mock/health";
import { allCranks } from "@/lib/mock/cranks";
import { resolveObject, searchAll } from "@/lib/mock/registry";
import { legalDocsOf } from "@/lib/mock/documents";
import type {
  DataSource,
  GovernanceResult,
  HoldersResult,
  AddressResult,
  HealthResult,
  ProtocolStatsDTO,
  CategoryStatDTO,
} from "./source";
import type { Asset, Dispute, ObjectRef, ProtocolEvent, TxRow, Validator, WalrusDoc } from "@/lib/types";
import type { RankedHolder } from "@/lib/mock/holders";
import type { Solvency } from "@/lib/mock/health";
import type { CrankOp } from "@/lib/mock/cranks";
import type { SearchResult } from "@/lib/mock/registry";

function configToDisplay(): Record<string, string> {
  const c = protocolConfig;
  return {
    protocol_fee_bps: String(c.protocolFeeBps),
    min_validator_stake: String(c.minValidatorStake),
    vouch_coverage_bps: String(c.vouchCoverageBps),
    challenger_bond: String(c.challengerBond),
    jury_quorum: String(c.juryQuorum),
    jury_threshold_bps: String(c.juryThresholdBps),
    jury_min_stake: String(c.juryMinStake),
    challenger_bounty_bps: String(c.challengerBountyBps),
    dispute_window_ms: String(c.disputeWindowMs),
    compensation_grace_ms: String(c.compensationGraceMs),
    min_wrap_duration_ms: String(c.minWrapDurationMs),
  };
}

export const mockSource: DataSource = {
  kind: "mock",
  async listAssets(): Promise<Asset[]> {
    return assets;
  },
  async getAsset(id): Promise<Asset | null> {
    return assetById[id] ?? null;
  },
  async listValidators(): Promise<Validator[]> {
    return validators;
  },
  async getValidator(poolId): Promise<Validator | null> {
    return validatorByPool[poolId] ?? null;
  },
  async listDisputes(): Promise<Dispute[]> {
    return disputes;
  },
  async getDispute(id): Promise<Dispute | null> {
    return disputeById[id] ?? null;
  },
  async getHolders(assetId): Promise<HoldersResult> {
    return { entries: holdersOf(assetId), totalMinted: supplyOf(assetId).minted };
  },
  async recentEvents(limit = 12): Promise<ProtocolEvent[]> {
    return mockRecent(limit);
  },
  async eventsForAsset(assetId, limit = 20): Promise<ProtocolEvent[]> {
    return mockEventsForAsset(assetId).slice(0, limit);
  },
  async getGovernance(): Promise<GovernanceResult> {
    return { history: paramHistory, paused: protocolConfig.paused, config: configToDisplay() };
  },
  async getTx(digest): Promise<TxRow | null> {
    return txByDigest(digest) ?? null;
  },
  async getAddress(address): Promise<AddressResult> {
    const acct = accountByAddr(address);
    return { address, roles: acct.roles, holdings: holdingsOf(address) };
  },
  async health(): Promise<HealthResult> {
    return { ok: true, stale: false };
  },

  async getProtocolStats(): Promise<ProtocolStatsDTO> {
    return protocolStats;
  },
  async getCategoryStats(): Promise<CategoryStatDTO[]> {
    return categoryStats();
  },
  async getAssetByAccId(accId): Promise<Asset | null> {
    return assetByAccId[accId] ?? null;
  },
  async disputesForAsset(assetId): Promise<Dispute[]> {
    return mockDisputesForAsset(assetId);
  },
  async holderDistribution(assetId): Promise<RankedHolder[]> {
    return holderDistribution(assetId);
  },
  async getSolvency(assetId): Promise<Solvency> {
    return solvencyOf(assetId);
  },
  async allCranks(): Promise<CrankOp[]> {
    return allCranks();
  },
  async resolveObject(id): Promise<ObjectRef | null> {
    return resolveObject(id);
  },
  async searchAll(query, limit = 24): Promise<SearchResult[]> {
    return searchAll(query, limit);
  },
  async getLegalDocs(assetId): Promise<WalrusDoc[]> {
    return legalDocsOf(assetId);
  },
  async addressActivity(address, limit = 30): Promise<ProtocolEvent[]> {
    return eventsForActor(address).slice(0, limit);
  },
};
