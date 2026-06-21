"use client";

import { useState } from "react";
import type { WalrusDoc as WalrusDocT, DocKind } from "@/lib/types";
import { cn, shortHash, type Tone } from "@/lib/format";
import { walrusUrl, fetchAndVerify, type VerifyStatus } from "@/lib/walrus/client";
import { Pill } from "@/components/ui/primitives";
import { IdLink } from "@/components/ui/IdLink";
import { Alert, Check, Copy, Doc, ExternalLink, Shield } from "@/components/ui/icons";

const KIND_LABEL: Record<DocKind, string> = {
  legal: "Legal",
  proof: "Milestone proof",
  evidence: "Evidence",
};
const KIND_TONE: Record<DocKind, Tone> = {
  legal: "info",
  proof: "positive",
  evidence: "danger",
};

/** The protocol's A13 story, shown wherever a content hash is rendered. */
export const SHA_EXPLAINER =
  "Content-pinned by sha256: the chain stores this hash, so re-uploading a different file to the same Walrus blob changes the hash and is detectable.";

/**
 * A content-addressed off-chain document (`WalrusRef`, §3.5): an open/download
 * link to the Walrus blob, the on-chain `sha256` (truncated + copyable, with the
 * integrity explainer), and the attestor linked to its address page. The bytes
 * are mocked (no real fetch) but the pointer + hash + attestor are real (FE-M4).
 */
export function WalrusDoc({ doc, compact = false }: { doc: WalrusDocT; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [verify, setVerify] = useState<VerifyStatus | "checking" | null>(null);

  function copySha(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(doc.sha256).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  }

  async function runVerify(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setVerify("checking");
    try {
      const r = await fetchAndVerify(doc.blobId, doc.sha256);
      setVerify(r.status);
    } catch {
      setVerify("unavailable");
    }
  }

  if (compact) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
        <Doc className="h-3.5 w-3.5 shrink-0 text-muted-2" />
        <a
          href={walrusUrl(doc.blobId)}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-medium text-foreground hover:text-primary hover:underline"
        >
          {doc.label}
        </a>
        <span className="font-mono text-muted-2" title={`${doc.sha256}\n\n${SHA_EXPLAINER}`}>
          {shortHash(doc.sha256, 6, 4)}
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-2" />
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", KIND_TONE[doc.kind] === "danger" ? "bg-danger-soft text-danger" : KIND_TONE[doc.kind] === "positive" ? "bg-positive-soft text-positive" : "bg-info-soft text-info")}>
            <Doc className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{doc.label}</span>
              <Pill tone={KIND_TONE[doc.kind]}>{KIND_LABEL[doc.kind]}</Pill>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-2" title={doc.blobId}>
              {doc.blobId}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-2">
              Attested by <IdLink id={doc.attestedBy} />
            </div>
          </div>
        </div>
        <a
          href={walrusUrl(doc.blobId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          Open <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* sha256 — copyable, with the content-integrity explainer */}
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
        <span
          className="inline-flex items-center gap-1 text-[11px] font-medium text-positive"
          title={SHA_EXPLAINER}
        >
          <Shield className="h-3.5 w-3.5" /> sha256-pinned
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={doc.sha256}>
          {shortHash(doc.sha256)}
        </span>
        <button
          onClick={copySha}
          aria-label="Copy sha256"
          className="text-muted-2 transition-colors hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Real Walrus fetch + sha256 re-check (A13): fetch the blob, recompute the hash,
          compare to the on-chain pin. Degrades to "couldn't verify" for mock/expired blobs. */}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={runVerify}
          disabled={verify === "checking"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-60"
        >
          <Shield className="h-3.5 w-3.5" />
          {verify === "checking" ? "Verifying…" : "Verify on Walrus"}
        </button>
        {verify === "verified" && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-positive">
            <Check className="h-3.5 w-3.5" /> Hash matches — content authentic
          </span>
        )}
        {verify === "mismatch" && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger">
            <Alert className="h-3.5 w-3.5" /> Hash mismatch — content tampered
          </span>
        )}
        {verify === "unavailable" && (
          <span className="text-[11px] text-muted-2" title="The blob is not on Walrus (mock or expired storage). The on-chain hash is still pinned.">
            Couldn&apos;t fetch blob — hash still pinned on-chain
          </span>
        )}
      </div>
    </div>
  );
}
