// Universal object index (FE-M1/FE-M2). Resolves ANY id to its canonical
// explorer route — the routing brain behind `/objects/:id`, the clickable graph,
// and global search. Guarantees MI-6: every id referenced anywhere resolves.
//
// Routing note: `token` resolves to its dedicated `/tokens/:accId` page (FE-M6)
// and `config` to `/governance` (FE-M6). `dispute` resolves to `/disputes/:id`
// (FE-M4). This is the single place to repoint any kind. Nothing 404s.

import type { ObjectKind, ObjectRef } from "../types";
import { assets, assetById, validators, validatorByPool, disputes, disputeById, protocolConfig } from "./data";
import { accounts, accountByAddr } from "./accounts";
import { allEvents } from "./activity";

// accumulator id → owning asset id
const accToAsset: Record<string, string> = {};
for (const a of assets) if (a.accumulator) accToAsset[a.accumulator.id] = a.id;

const txDigests = new Set(allEvents.map((e) => e.txDigest));

/** Resolve an exact id to its route, or null if it can't be identified at all. */
export function resolveObject(id: string): ObjectRef | null {
  if (!id) return null;
  if (assetById[id]) return { id, kind: "asset", route: `/assets/${id}`, label: assetById[id].name };
  if (accToAsset[id]) {
    const aid = accToAsset[id];
    return { id, kind: "token", route: `/tokens/${id}`, label: `${assetById[aid].accumulator!.tokenSymbol} token` };
  }
  if (validatorByPool[id]) return { id, kind: "validator", route: `/validators/${id}`, label: validatorByPool[id].name };
  if (disputeById[id]) return { id, kind: "dispute", route: `/disputes/${id}`, label: `Dispute · ${disputeById[id].assetName}` };
  if (id === protocolConfig.configId) return { id, kind: "config", route: `/governance`, label: "Protocol config" };
  if (txDigests.has(id)) return { id, kind: "tx", route: `/tx/${id}`, label: "Transaction" };
  if (id.startsWith("0x")) {
    const acc = accountByAddr(id);
    return { id, kind: "account", route: `/address/${id}`, label: acc.label };
  }
  return null;
}

/** Route for an id (or `/objects/:id` so the resolver page can decide) — never null. */
export function routeForId(id: string): string {
  return resolveObject(id)?.route ?? `/objects/${id}`;
}

export interface SearchResult {
  kind: ObjectKind;
  id: string;
  route: string;
  title: string;
  subtitle: string;
}

const KIND_RANK: Record<ObjectKind, number> = {
  asset: 0,
  token: 1,
  validator: 2,
  account: 3,
  dispute: 4,
  tx: 5,
  config: 6,
};

/** Global search across every entity kind (powers ⌘K + /search). */
export function searchAll(query: string, limit = 24): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchResult[] = [];
  const has = (...vals: (string | undefined)[]) => vals.some((v) => v?.toLowerCase().includes(q));

  for (const a of assets) {
    if (has(a.name, a.ticker, a.id, a.entityName, a.location, a.category, a.accumulator?.tokenSymbol)) {
      out.push({ kind: "asset", id: a.id, route: `/assets/${a.id}`, title: a.name, subtitle: `${a.ticker} · ${a.category} · ${a.state}` });
    }
  }
  for (const v of validators) {
    if (has(v.name, v.poolId, v.address)) {
      out.push({ kind: "validator", id: v.poolId, route: `/validators/${v.poolId}`, title: v.name, subtitle: `Validator · ${v.status}` });
    }
  }
  for (const acc of accounts) {
    if (has(acc.label, acc.address)) {
      out.push({ kind: "account", id: acc.address, route: `/address/${acc.address}`, title: acc.label ?? acc.address, subtitle: `Account · ${acc.roles.join(", ")}` });
    }
  }
  for (const d of disputes) {
    if (has(d.id, d.assetName, d.targetValidatorName)) {
      out.push({ kind: "dispute", id: d.id, route: `/disputes/${d.id}`, title: `Dispute · ${d.assetName}`, subtitle: `vs ${d.targetValidatorName} · ${d.status}` });
    }
  }

  // exact id / address / tx digest paste-in
  if (q.startsWith("0x") || q.startsWith("asset") || q.startsWith("acc")) {
    const ref = resolveObject(query.trim());
    if (ref && !out.some((r) => r.id === ref.id)) {
      out.push({ kind: ref.kind, id: ref.id, route: ref.route, title: ref.label ?? ref.id, subtitle: `${ref.kind} (exact match)` });
    }
  }

  return out.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]).slice(0, limit);
}
