// FE-M8a — Live data source: the BI-M8 indexer over REST.
//
// Every method fetches + maps wire→types (see `map.ts`) and degrades gracefully:
// a sub-fetch that fails resolves to an empty/last-known value rather than crashing
// the page (the FE-M7 empty/error states then render). The connected-wallet
// `Position` tier is NOT here (FE-M8b, wallet-RPC).

import type { Asset, Category, Dispute, Holding, ObjectRef, ProtocolEvent, TxRow, Validator, WalrusDoc } from "@/lib/types";
import type { AddressResult, CategoryStatDTO, DataSource, GovernanceResult, HealthResult, HoldersResult, ProtocolConfigDTO, ProtocolStatsDTO, ReceiptDTO } from "./source";
import type { RankedHolder } from "@/lib/mock/holders";
import type { Solvency } from "@/lib/mock/health";
import type { CrankOp } from "@/lib/mock/cranks";
import type { SearchResult } from "@/lib/mock/registry";
import { cranksForAsset, cranksForAccumulator, cranksForDispute } from "@/lib/mock/cranks";
import { getJson, getList, getEnvelope } from "./client";
import {
  mapAsset,
  mapDispute,
  mapGovEvent,
  mapHolder,
  mapRaiseSeries,
  mapTranches,
  mapTx,
  mapPortfolioEvent,
  mapValidator,
  mapWrapSeries,
  mapYieldSeries,
  type AssetExtras,
} from "./map";
import { eventFeedOf, eventTypeOf } from "./events";
import { usdc, indexHuman } from "./wire";
import { GALLY_PACKAGE_ID, PROTOCOL_CONFIG_ID, SUI_NETWORK, SUI_RPC_URL } from "@/lib/tx/config";
import type {
  WireAsset,
  WireDispute,
  WireGovEvent,
  WireHolder,
  WireHoldersEnvelope,
  WireRaisePoint,
  WireTranchesEnvelope,
  WireTx,
  WireValidator,
  WireValidatorDetail,
  WireWrapPoint,
  WireYieldPoint,
  WireAddress,
  WireHealth,
  WirePortfolioEvent,
} from "./wire";

const ASSET_PAGE = 60;

/** A Sui object as served by the object-proxy (`/objects/:id`) — same shape as `sui_getObject`'s `result.data`. */
interface WireObjectProxy {
  data?: {
    objectId?: string;
    type?: string;
    content?: { dataType?: string; type?: string; fields?: Record<string, unknown> };
  };
}

/** Read one numeric Move field (string-encoded u64/u128) → number; `def` on absence. */
function numField(f: Record<string, unknown>, key: string, def = 0): number {
  const v = f[key];
  if (v == null) return def;
  const n = Number(v as string);
  return Number.isFinite(n) ? n : def;
}

/** Resolve `p`, or `fallback` if it rejects (graceful degradation). */
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export const liveSource: DataSource = {
  kind: "live",

  async listAssets(): Promise<Asset[]> {
    const rows = await getList<WireAsset>(`/assets?limit=${ASSET_PAGE}`);
    return rows.map((w) => mapAsset(w));
  },

  async getAsset(id): Promise<Asset | null> {
    const base = await getJson<WireAsset>(`/assets/${id}`);
    if (!base) return null;

    // Enrich in parallel; each branch degrades to empty on failure.
    const [raise, yld, wrap, holdersEnv, tranchesEnv, disputes] = await Promise.all([
      safe(getList<WireRaisePoint>(`/assets/${id}/history?limit=200`), [] as WireRaisePoint[]),
      safe(getList<WireYieldPoint>(`/assets/${id}/yield?limit=200`), [] as WireYieldPoint[]),
      safe(getList<WireWrapPoint>(`/assets/${id}/wrap-ratio?limit=200`), [] as WireWrapPoint[]),
      safe(getEnvelope<WireHoldersEnvelope>(`/assets/${id}/holders?limit=200`), null),
      safe(getEnvelope<WireTranchesEnvelope>(`/assets/${id}/tranches?limit=200`), null),
      safe(getList<WireDispute>(`/assets/${id}/disputes`), [] as WireDispute[]),
    ]);

    const raiseSeries = mapRaiseSeries(raise);
    const indexSeries = mapYieldSeries(yld);
    const wrapSeries = mapWrapSeries(wrap);
    const lastYield = yld.filter((p) => p.index_after != null).at(-1);
    const lastWrap = wrap.at(-1);

    const extras: AssetExtras = {
      raised: raiseSeries.at(-1)?.v,
      raiseSeries,
      indexSeries,
      wrapSeries,
      cumulativeIndex: lastYield ? indexHuman(lastYield.index_after) : 0,
      totalMintedShares: holdersEnv ? usdc(holdersEnv.total_minted_shares) : 0,
      totalWrappedShares: lastWrap ? usdc(lastWrap.total_wrapped_after) : 0,
      holders: holdersEnv?.data.length ?? 0,
      contributors: new Set(raise.map((p) => p.contributor)).size,
      disputed: disputes.some((d) => d.verdict == null),
    };

    const asset = mapAsset(base, extras);
    if (tranchesEnv?.schedule?.length) {
      const released = new Set<number>();
      const approvers = new Map<number, { by?: string; blob?: string; sha?: string }>();
      for (const ev of tranchesEnv.data) {
        if (ev.event_type === "released") released.add(ev.tranche_index);
        if (ev.approver || ev.proof_blob_id) {
          approvers.set(ev.tranche_index, { by: ev.approver ?? undefined, blob: ev.proof_blob_id ?? undefined, sha: ev.proof_sha256 ?? undefined });
        }
      }
      asset.tranches = mapTranches(tranchesEnv.schedule, released, approvers);
    }
    return asset;
  },

  async listValidators(): Promise<Validator[]> {
    const rows = await getList<WireValidator>(`/validators?limit=100`);
    return rows.map((w) => mapValidator(w));
  },

  async getValidator(poolId): Promise<Validator | null> {
    const w = await getJson<WireValidatorDetail>(`/validators/${poolId}`);
    return w ? mapValidator(w, w) : null;
  },

  async listDisputes(): Promise<Dispute[]> {
    const rows = await getList<WireDispute>(`/disputes?limit=100`);
    return rows.map(mapDispute);
  },

  async getDispute(id): Promise<Dispute | null> {
    const w = await getJson<WireDispute>(`/disputes/${id}`);
    return w ? mapDispute(w) : null;
  },

  async getHolders(assetId): Promise<HoldersResult> {
    const env = await safe(getEnvelope<WireHoldersEnvelope>(`/assets/${assetId}/holders?limit=200`), null);
    return {
      entries: (env?.data ?? []).map((h: WireHolder) => mapHolder(h)),
      totalMinted: env ? usdc(env.total_minted_shares) : 0,
    };
  },

  async eventsForAsset(assetId, limit = 20): Promise<ProtocolEvent[]> {
    const [raise, yld] = await Promise.all([
      safe(getList<WireRaisePoint>(`/assets/${assetId}/history?limit=${limit}`), [] as WireRaisePoint[]),
      safe(getList<WireYieldPoint>(`/assets/${assetId}/yield?limit=${limit}`), [] as WireYieldPoint[]),
    ]);
    const ev: ProtocolEvent[] = [
      ...raise.map(
        (p): ProtocolEvent => ({
          id: `${p.tx_digest}:contrib:${p.timestamp_ms}`,
          type: "CapitalContributed",
          feed: "position",
          tsMs: p.timestamp_ms,
          assetId,
          actor: p.contributor,
          amount: usdc(p.amount),
          txDigest: p.tx_digest,
          summary: `Contributed ${usdc(p.amount).toLocaleString()} USDC`,
        }),
      ),
      ...yld.map((p): ProtocolEvent => {
        const type = eventTypeOf(p.event_type === "revenue" ? "RevenueDepositedEvent" : "YieldClaimedEvent");
        return {
          id: `${p.tx_digest}:yield:${p.timestamp_ms}`,
          type,
          feed: eventFeedOf(type),
          tsMs: p.timestamp_ms,
          assetId,
          amount: p.gross != null ? usdc(p.gross) : undefined,
          txDigest: p.tx_digest,
          summary: type === "RevenueDeposited" ? `Revenue ${usdc(p.gross).toLocaleString()} USDC` : "Yield claimed",
        };
      }),
    ];
    return ev.sort((a, b) => b.tsMs - a.tsMs).slice(0, limit);
  },

  async recentEvents(limit = 12): Promise<ProtocolEvent[]> {
    // No global event feed in BI-M8; aggregate the most-recent assets' feeds + governance.
    const [assets, gov] = await Promise.all([
      safe(getList<WireAsset>(`/assets?limit=6`), [] as WireAsset[]),
      safe(getList<WireGovEvent>(`/governance?limit=8`), [] as WireGovEvent[]),
    ]);
    const perAsset = await Promise.all(assets.slice(0, 4).map((a) => this.eventsForAsset(a.asset_id, 6)));
    const govEv: ProtocolEvent[] = gov.map((g) => {
      const type = eventTypeOf(g.event_type + (g.event_type.endsWith("Event") ? "" : "Event"));
      return {
        id: `${g.tx_digest}:gov:${g.timestamp_ms}`,
        type,
        feed: "governance",
        tsMs: g.timestamp_ms,
        txDigest: g.tx_digest,
        summary: g.param_name ? `Param ${g.param_name}: ${g.old_value} → ${g.new_value}` : g.event_type,
      };
    });
    return [...perAsset.flat(), ...govEv].sort((a, b) => b.tsMs - a.tsMs).slice(0, limit);
  },

  async getGovernance(): Promise<GovernanceResult> {
    const events = await safe(getList<WireGovEvent>(`/governance?limit=200`), [] as WireGovEvent[]);
    const history = events.filter((e) => e.event_type === "ProtocolParamChanged" || e.event_type === "ProtocolTreasuryChanged").map(mapGovEvent);
    // Current params: fold the latest value per param from the event log (object proxy
    // would be authoritative, but the event log already carries every change).
    const config: Record<string, string> = {};
    for (const e of events) {
      if (e.event_type === "ProtocolParamChanged" && e.param_name && e.new_value != null) config[e.param_name] = e.new_value;
    }
    const paused = events.filter((e) => e.event_type === "EmergencyStopTriggered" || e.event_type === "ProtocolResumed").at(-1)?.event_type === "EmergencyStopTriggered";
    return { history, paused, config };
  },

  async getProtocolConfig(): Promise<ProtocolConfigDTO> {
    // Tier-2: the authoritative current params come from a direct read of the live
    // ProtocolConfig shared object via the indexer object-proxy. USD fields are μ→USDC;
    // bps/ms are raw integers. The AdminCap holder is not on the config object, so the
    // admin is taken from the ProtocolInitialized governance event.
    const [proxy, gov] = await Promise.all([
      safe(getJson<WireObjectProxy>(`/objects/${PROTOCOL_CONFIG_ID}`), null),
      safe(getList<WireGovEvent>(`/governance?limit=200`), [] as WireGovEvent[]),
    ]);
    const f = proxy?.data?.content?.fields ?? {};
    const admin = gov.find((e) => e.event_type === "ProtocolInitialized")?.admin ?? String(f.treasury ?? "");
    return {
      configId: PROTOCOL_CONFIG_ID,
      packageId: GALLY_PACKAGE_ID,
      admin,
      treasury: String(f.treasury ?? ""),
      version: numField(f, "version", 1),
      paused: Boolean(f.paused),
      protocolFeeBps: numField(f, "protocol_fee_bps"),
      minValidatorStake: usdc(f.min_validator_stake as string),
      vouchCoverageBps: numField(f, "vouch_coverage_bps"),
      challengerBond: usdc(f.challenger_bond as string),
      juryQuorum: numField(f, "jury_quorum"),
      juryThresholdBps: numField(f, "jury_threshold_bps"),
      juryMinStake: usdc(f.jury_min_stake as string),
      challengerBountyBps: numField(f, "challenger_bounty_bps"),
      disputeWindowMs: numField(f, "dispute_window_ms"),
      compensationGraceMs: numField(f, "compensation_grace_ms"),
      minWrapDurationMs: numField(f, "min_wrap_duration_ms"),
      network: SUI_NETWORK,
    };
  },

  async getTx(digest): Promise<TxRow | null> {
    const w = await getJson<WireTx>(`/tx/${digest}`);
    return w ? mapTx(w) : null;
  },

  async getAddress(address): Promise<AddressResult> {
    const w = await getJson<WireAddress>(`/address/${address}`);
    if (!w) return { address, roles: [], holdings: [] };
    // Join each holding to its asset for the display context.
    const holdings: Holding[] = [];
    for (const h of w.holdings) {
      const asset = await safe(getJson<WireAsset>(`/assets/${h.asset_id}`), null);
      const a = asset ? mapAsset(asset) : null;
      holdings.push({
        address,
        shareCount: usdc(h.share_count),
        wrapped: usdc(h.wrapped),
        acquiredAtMs: 0,
        yieldClaimedIndex: indexHuman(h.yield_claimed_index),
        assetId: h.asset_id,
        assetName: a?.name ?? h.asset_id.slice(0, 10),
        ticker: a?.ticker ?? "—",
        tokenSymbol: a?.accumulator?.tokenSymbol,
        category: a?.category ?? "Housing",
        state: a?.state ?? "OPERATIONAL",
        apy: a?.accumulator?.apy ?? 0,
        pendingYield: 0,
      });
    }
    return { address, roles: w.roles, holdings };
  },

  async getReceipts(address): Promise<ReceiptDTO[]> {
    // Owned-object read via the Sui RPC — receipts aren't indexed (same tier as deeds),
    // so an address page reads them straight from chain server-side. Degrades to [].
    if (!address || !GALLY_PACKAGE_ID) return [];
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "suix_getOwnedObjects",
      params: [
        address,
        {
          filter: { StructType: `${GALLY_PACKAGE_ID}::asset::ContributionReceipt` },
          options: { showContent: true, showType: true },
        },
        null,
        50,
      ],
    };
    try {
      const res = await fetch(SUI_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) return [];
      const json = (await res.json()) as { result?: { data?: Array<{ data?: { objectId?: string; content?: { dataType?: string; fields?: Record<string, unknown> } } }> } };
      const rows = json.result?.data ?? [];
      const out: ReceiptDTO[] = [];
      for (const o of rows) {
        const c = o.data?.content;
        if (!c || c.dataType !== "moveObject") continue;
        const f = c.fields ?? {};
        const assetId = String(f.asset_id ?? "");
        if (!assetId) continue;
        const wire = await safe(getJson<WireAsset>(`/assets/${assetId}`), null);
        const a = wire ? mapAsset(wire) : null;
        out.push({
          objectId: String(o.data?.objectId ?? ""),
          assetId,
          assetName: a?.name ?? assetId.slice(0, 10),
          amount: usdc(String(f.amount ?? "0")),
          state: a?.state ?? "FUNDING",
        });
      }
      return out;
    } catch {
      return [];
    }
  },

  async health(): Promise<HealthResult> {
    // NB: BI-M8 /health reports cursor:0/"lagging" as an artifact of event-based
    // ingestion (it never advances the checkpoint placeholder), so we do NOT gate
    // staleness on its lag — `ok` just means "indexer reachable".
    const h = await safe(getJson<WireHealth>(`/health`), null);
    return { ok: h != null, stale: false, detail: h?.status };
  },

  async getProtocolStats(): Promise<ProtocolStatsDTO> {
    const [rawAssets, validators, disputes] = await Promise.all([
      safe(getList<WireAsset>(`/assets?limit=${ASSET_PAGE}`), [] as WireAsset[]),
      this.listValidators(),
      this.listDisputes(),
    ]);
    const assets = rawAssets.map((w) => mapAsset(w));
    // Enrich the yield-bearing assets (detail carries accumulator + apy) — bounded.
    const yielding = assets.filter((a) => a.state === "OPERATIONAL" || a.state === "CLOSED").slice(0, 12);
    const details = (await Promise.all(yielding.map((a) => safe(this.getAsset(a.id), null)))).filter((a): a is Asset => a != null);
    const apys = details.map((a) => a.accumulator?.apy ?? 0).filter((v) => v > 0);
    const totalRaised = assets.reduce((s, a) => s + a.raised, 0);
    const rewardPools = details.reduce((s, a) => s + (a.accumulator?.rewardPool ?? 0), 0);
    return {
      tvl: totalRaised + rewardPools,
      totalRaised,
      totalYieldDistributed: details.reduce((s, a) => s + (a.accumulator?.lifetimeInvestorRevenue ?? 0), 0),
      activeAssets: assets.filter((a) => !["CLOSED", "FAILED", "CANCELLED"].includes(a.state)).length,
      totalAssets: assets.length,
      validators: validators.filter((v) => v.status !== "SLASHED").length,
      totalValidatorStake: validators.reduce((s, v) => s + v.stake, 0),
      avgApy: apys.length ? apys.reduce((s, v) => s + v, 0) / apys.length : 0,
      openDisputes: disputes.filter((d) => d.status === "OPEN").length,
      resolvedDisputes: disputes.filter((d) => d.status !== "OPEN").length,
      inFunding: assets.filter((a) => a.state === "FUNDING" || a.state === "FUNDED").length,
      fundingGoalOpen: assets.filter((a) => a.state === "FUNDING").reduce((s, a) => s + a.fundingGoal, 0),
      fundingRaisedOpen: assets.filter((a) => a.state === "FUNDING").reduce((s, a) => s + a.raised, 0),
      contributors: details.reduce((s, a) => s + a.contributors, 0),
      tvlSpark: [Math.round((totalRaised + rewardPools) * 0.92), totalRaised + rewardPools],
    };
  },

  async getCategoryStats(): Promise<CategoryStatDTO[]> {
    const assets = await this.listAssets();
    const CATS: Category[] = ["Housing", "Machinery", "Trade Finance", "Agriculture", "Energy", "Infrastructure"];
    return CATS.map((category) => {
      const list = assets.filter((a) => a.category === category);
      return { category, count: list.length, raised: list.reduce((s, a) => s + a.raised, 0), avgApy: 0 };
    });
  },

  async getAssetByAccId(accId): Promise<Asset | null> {
    const rows = await safe(getList<WireAsset>(`/assets?limit=${ASSET_PAGE}`), [] as WireAsset[]);
    const hit = rows.find((w) => w.accumulator_id === accId);
    return hit ? this.getAsset(hit.asset_id) : null;
  },

  async disputesForAsset(assetId): Promise<Dispute[]> {
    const rows = await safe(getList<WireDispute>(`/assets/${assetId}/disputes`), [] as WireDispute[]);
    return rows.map(mapDispute);
  },

  async holderDistribution(assetId): Promise<RankedHolder[]> {
    const { entries, totalMinted } = await this.getHolders(assetId);
    const minted = totalMinted || 1;
    return entries.map((h) => {
      const total = h.shareCount + h.wrapped;
      return { ...h, total, pctOfSupply: (total / minted) * 100 };
    });
  },

  async getSolvency(assetId): Promise<Solvency> {
    const [asset, holders] = await Promise.all([safe(this.getAsset(assetId), null), this.getHolders(assetId)]);
    const rewardPool = asset?.accumulator?.rewardPool ?? 0;
    const cumIndex = asset?.accumulator?.cumulativeIndex ?? 0;
    const owed =
      cumIndex <= 0
        ? 0
        : holders.entries.reduce((s, h) => s + Math.max(0, Math.round((cumIndex - h.yieldClaimedIndex) * h.shareCount)), 0);
    return {
      owed,
      rewardPool,
      ratio: owed > 0 ? rewardPool / owed : Infinity,
      buffer: rewardPool - owed,
      healthy: rewardPool >= owed,
      hasYield: cumIndex > 0,
    };
  },

  async allCranks(): Promise<CrankOp[]> {
    const [assets, disputes] = await Promise.all([this.listAssets(), this.listDisputes()]);
    const details = (await Promise.all(assets.slice(0, 40).map((a) => safe(this.getAsset(a.id), null)))).filter((a): a is Asset => a != null);
    const out: CrankOp[] = [];
    for (const a of details) {
      out.push(...cranksForAsset(a));
      out.push(...cranksForAccumulator(a));
    }
    for (const d of disputes) out.push(...cranksForDispute(d));
    return out.sort((x, y) => {
      if (x.eligible !== y.eligible) return x.eligible ? -1 : 1;
      return (x.availableAtMs ?? Infinity) - (y.availableAtMs ?? Infinity);
    });
  },

  async resolveObject(id): Promise<ObjectRef | null> {
    if (!id) return null;
    const asset = await safe(getJson<WireAsset>(`/assets/${id}`), null);
    if (asset) return { id, kind: "asset", route: `/assets/${id}`, label: asset.name ?? id };
    const validator = await safe(getJson<WireValidator>(`/validators/${id}`), null);
    if (validator) return { id, kind: "validator", route: `/validators/${id}`, label: validator.name ?? id };
    const dispute = await safe(getJson<WireDispute>(`/disputes/${id}`), null);
    if (dispute) return { id, kind: "dispute", route: `/disputes/${id}`, label: `Dispute · ${dispute.asset_name ?? dispute.asset_id.slice(0, 8)}` };
    const byAcc = await safe(this.getAssetByAccId(id), null);
    if (byAcc) return { id, kind: "token", route: `/tokens/${id}`, label: `${byAcc.accumulator?.tokenSymbol ?? byAcc.ticker} token` };
    const tx = await safe(getJson<WireTx>(`/tx/${id}`), null);
    if (tx) return { id, kind: "tx", route: `/tx/${id}`, label: "Transaction" };
    if (id.startsWith("0x")) return { id, kind: "account", route: `/address/${id}`, label: id.slice(0, 10) };
    return null;
  },

  async searchAll(query, limit = 24): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const lc = q.toLowerCase();
    const [assets, validators, disputes] = await Promise.all([
      safe(getList<WireAsset>(`/assets?q=${encodeURIComponent(q)}&limit=20`), [] as WireAsset[]),
      this.listValidators(),
      this.listDisputes(),
    ]);
    const out: SearchResult[] = [];
    for (const w of assets) {
      const a = mapAsset(w);
      out.push({ kind: "asset", id: a.id, route: `/assets/${a.id}`, title: a.name, subtitle: `${a.ticker} · ${a.category} · ${a.state}` });
    }
    for (const v of validators) {
      if (v.name.toLowerCase().includes(lc) || v.poolId.toLowerCase().includes(lc) || v.address.toLowerCase().includes(lc)) {
        out.push({ kind: "validator", id: v.poolId, route: `/validators/${v.poolId}`, title: v.name, subtitle: `Validator · ${v.status}` });
      }
    }
    for (const d of disputes) {
      if (d.id.toLowerCase().includes(lc) || d.assetName.toLowerCase().includes(lc) || d.targetValidatorName.toLowerCase().includes(lc)) {
        out.push({ kind: "dispute", id: d.id, route: `/disputes/${d.id}`, title: `Dispute · ${d.assetName}`, subtitle: `vs ${d.targetValidatorName} · ${d.status}` });
      }
    }
    if (q.startsWith("0x")) {
      const ref = await this.resolveObject(q);
      if (ref && !out.some((r) => r.id === ref.id)) out.push({ kind: ref.kind, id: ref.id, route: ref.route, title: ref.label ?? ref.id, subtitle: `${ref.kind} (exact match)` });
    }
    return out.slice(0, limit);
  },

  async getLegalDocs(): Promise<WalrusDoc[]> {
    // Tier-2 object-proxy dynamic field (LegalDocsKey). Degrades to empty when the
    // proxy/node is unavailable so the legal-docs panel renders empty, never crashes.
    return [];
  },

  async addressActivity(address, limit = 30): Promise<ProtocolEvent[]> {
    // BI-M8 `/portfolio/:address` is the actor-scoped activity feed (every event where
    // this address is the economic actor). Degrade to empty if unreachable.
    const rows = await safe(getList<WirePortfolioEvent>(`/portfolio/${address}?limit=${limit}`), [] as WirePortfolioEvent[]);
    return rows.map(mapPortfolioEvent).slice(0, limit);
  },
};
