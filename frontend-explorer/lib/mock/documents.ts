// Document fixtures (FE-M1). The chain stores only a Walrus blob id + sha256 +
// attestor per document (`WalrusRef`, §3.5); the bytes live on Walrus. These
// fixtures model that pointer layer so FE-M4 can render download + verify.
//
// Three document classes:
//   legal     — vouched legal docs attached to the Asset (set at vouch, §7)
//   proof     — per-tranche milestone evidence (submit → approve, §9)
//   evidence  — a dispute challenger's sha256-pinned counter-evidence (§13)

import type { Asset, WalrusDoc } from "../types";
import { assets, disputes, validatorByPool } from "./data";
import { seeded } from "./series";

/** Mock Walrus aggregator base — resolves a blob id to a (placeholder) URL. */
export const WALRUS_AGGREGATOR = "https://walrus-testnet-aggregator.example/v1";

/** Build the public Walrus URL for a blob id (download/open link, FE-M4). */
export const walrusUrl = (blobId: string): string => `${WALRUS_AGGREGATOR}/${blobId}`;

function hex(rnd: () => number, len: number): string {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += h[Math.floor(rnd() * 16)];
  return s;
}
const blobId = (rnd: () => number) => `blob_${hex(rnd, 40)}`;
const sha = (rnd: () => number) => `0x${hex(rnd, 64)}`;

const LEGAL_LABELS = [
  "Registered land title / lease",
  "Regulatory & environmental permits",
  "Entity incorporation & tranche covenant",
];

function buildLegal(a: Asset): WalrusDoc[] {
  // A vouch exists for any asset past PENDING_VOUCH/CANCELLED (coverage was locked).
  if (a.state === "PENDING_VOUCH" || a.state === "CANCELLED") return [];
  const validator = validatorByPool[a.validatorPoolId];
  const attestedBy = validator?.address ?? a.validatorPoolId;
  const rnd = seeded(a.id.length * 104729 + a.fundingGoal);
  const count = 2 + (a.fundingGoal % 2); // 2–3 docs
  const docs: WalrusDoc[] = [];
  for (let i = 0; i < count; i++) {
    docs.push({
      blobId: blobId(rnd),
      sha256: sha(rnd),
      attestedBy,
      kind: "legal",
      label: LEGAL_LABELS[i % LEGAL_LABELS.length],
    });
  }
  return docs;
}

function buildProofs(a: Asset): WalrusDoc[] {
  const rnd = seeded(a.id.length * 1299709 + a.fundingGoal);
  const docs: WalrusDoc[] = [];
  for (const t of a.tranches) {
    if (!t.released && !t.approvedBy) continue; // only submitted-and-approved tranches have a proof
    docs.push({
      blobId: blobId(rnd),
      sha256: sha(rnd),
      attestedBy: t.approvedBy ?? a.validatorPoolId,
      kind: "proof",
      label: `Milestone ${t.index + 1} evidence — ${t.description}`,
      trancheIndex: t.index,
    });
  }
  return docs;
}

/** assetId → vouched legal documents. */
export const legalDocs: Record<string, WalrusDoc[]> = Object.fromEntries(
  assets.map((a) => [a.id, buildLegal(a)]),
);

/** assetId → milestone proof documents (one per approved/released tranche). */
export const trancheProofs: Record<string, WalrusDoc[]> = Object.fromEntries(
  assets.map((a) => [a.id, buildProofs(a)]),
);

/** disputeId → challenger evidence document. */
export const disputeEvidence: Record<string, WalrusDoc> = Object.fromEntries(
  disputes.map((d) => {
    const rnd = seeded(d.id.length * 15485863 + d.bond);
    return [
      d.id,
      {
        blobId: blobId(rnd),
        sha256: sha(rnd),
        attestedBy: d.challenger,
        kind: "evidence" as const,
        label: "Challenger counter-evidence",
      },
    ];
  }),
);

export const legalDocsOf = (assetId: string): WalrusDoc[] => legalDocs[assetId] ?? [];
export const proofsOf = (assetId: string): WalrusDoc[] => trancheProofs[assetId] ?? [];
export const proofOf = (assetId: string, trancheIndex: number): WalrusDoc | undefined =>
  (trancheProofs[assetId] ?? []).find((d) => d.trancheIndex === trancheIndex);
export const evidenceOf = (disputeId: string): WalrusDoc | undefined => disputeEvidence[disputeId];
