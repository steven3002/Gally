// FE-M4 unit tests: the document selectors (legal / proof / evidence), the
// Walrus URL builder, and the sha256 truncation helper. Pairs with the
// documents e2e spec (legal docs, tranche proofs, dispute evidence).

import { describe, it, expect } from "vitest";
import { assets, disputes } from "./data";
import { legalDocsOf, proofsOf, proofOf, evidenceOf, walrusUrl, WALRUS_AGGREGATOR } from "./documents";
import { shortHash } from "../format";

describe("document selectors (FE-M4)", () => {
  it("vouched assets expose legal docs (sha256 + attestor); unvouched have none", () => {
    for (const a of assets) {
      const docs = legalDocsOf(a.id);
      if (a.state === "PENDING_VOUCH" || a.state === "CANCELLED") {
        expect(docs.length).toBe(0);
      } else {
        expect(docs.length).toBeGreaterThan(0);
        for (const d of docs) {
          expect(d.kind).toBe("legal");
          expect(d.sha256.startsWith("0x")).toBe(true);
          expect(d.attestedBy.startsWith("0x")).toBe(true);
          expect(d.blobId.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("each approved/released tranche has exactly one proof, addressable by index", () => {
    for (const a of assets) {
      const approved = a.tranches.filter((t) => t.released || t.approvedBy);
      expect(proofsOf(a.id).length).toBe(approved.length);
      for (const t of approved) {
        const p = proofOf(a.id, t.index);
        expect(p?.kind).toBe("proof");
        expect(p?.trancheIndex).toBe(t.index);
      }
    }
  });

  it("every dispute has evidence attested by its challenger", () => {
    for (const d of disputes) {
      const ev = evidenceOf(d.id);
      expect(ev?.kind).toBe("evidence");
      expect(ev?.attestedBy).toBe(d.challenger);
      expect(ev?.sha256.startsWith("0x")).toBe(true);
    }
  });
});

describe("walrusUrl + shortHash (FE-M4)", () => {
  it("walrusUrl resolves a blob id under the aggregator base", () => {
    const url = walrusUrl("blob_abc123");
    expect(url.startsWith(WALRUS_AGGREGATOR)).toBe(true);
    expect(url.endsWith("/blob_abc123")).toBe(true);
  });

  it("shortHash truncates a sha256 but leaves short strings intact", () => {
    const sha = "0x" + "a".repeat(64);
    const s = shortHash(sha);
    expect(s).toContain("…");
    expect(s.startsWith("0x")).toBe(true);
    expect(s.length).toBeLessThan(sha.length);
    expect(shortHash("0xabcd")).toBe("0xabcd");
  });
});
