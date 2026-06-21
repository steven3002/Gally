"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx/useTx";
import { isBusy, TX_STATUS_LABEL } from "@/lib/tx/types";
import { intentRoute, intentSummary, optimisticKey, type TxIntent } from "@/lib/tx/intents";
import { applyOptimistic, useOptimistic } from "@/lib/tx/optimistic";
import { isLive } from "@/lib/data";
import { SUI_NETWORK } from "@/lib/tx/config";
import { uploadBlob } from "@/lib/walrus/client";
import { shortDigest, shortHash, usd } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";
import { Alert, Check, Doc, Scale, Shield, Wallet } from "@/components/ui/icons";

const VERB = "Raise dispute";

type Evidence =
  | { status: "idle" }
  | { status: "uploading"; name: string }
  | { status: "done"; name: string; blobId: string; sha256: string; size: number }
  | { status: "error"; name: string; msg: string };

/**
 * Raise a dispute against a validator's attestation (`dispute::initialize_dispute`).
 * A proper challenger flow: post the protocol's fixed `challenger_bond` (USDC stake,
 * refunded with a bounty if upheld, forfeited if rejected), state a reason, and
 * optionally attach an **evidence file that is uploaded to Walrus and sha256-hashed
 * in the browser** — the real `WalrusRef` (blob id + content hash) is pinned on-chain.
 */
export function DisputeAction({
  poolId,
  validatorName,
  assetId,
  bond,
}: {
  poolId: string;
  validatorName: string;
  assetId: string;
  bond: number;
}) {
  const { connected, connect } = useWallet();
  const { status, result, run, reset } = useTx();
  const { isApplied } = useOptimistic();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Challenged via explorer");
  const [ev, setEv] = useState<Evidence>({ status: "idle" });

  const busy = isBusy(status);
  const uploading = ev.status === "uploading";
  const done = status === "success" && result?.ok;
  const failed = status === "error";
  const bondInvalid = bond <= 0;

  // The key/summary/route are evidence-independent (the dispute targets the pool).
  const baseIntent: TxIntent = { kind: "raise_dispute", poolId, validatorName, assetId, bond };
  const applied = !open && isApplied(optimisticKey(baseIntent));

  function close() {
    setOpen(false);
    reset();
    setEv({ status: "idle" });
    setReason("Challenged via explorer");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEv({ status: "uploading", name: file.name });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const up = await uploadBlob(bytes);
      setEv({ status: "done", name: file.name, blobId: up.blobId, sha256: up.sha256, size: up.size });
    } catch (err) {
      setEv({ status: "error", name: file.name, msg: err instanceof Error ? err.message : "upload failed" });
    }
  }

  async function handleRun() {
    const intent: TxIntent = {
      kind: "raise_dispute",
      poolId,
      validatorName,
      assetId,
      bond,
      reason: reason.trim() || undefined,
      evidenceBlobId: ev.status === "done" ? ev.blobId : undefined,
      evidenceSha256: ev.status === "done" ? ev.sha256 : undefined,
    };
    const res = await run(intent);
    if (res.ok) applyOptimistic(intent);
  }

  // Already submitted — collapse to the cross-page applied chip (like ActionButton).
  if (applied) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-xl border border-positive/30 bg-positive-soft px-4 py-2 text-sm font-semibold text-positive"
        title="Submitted — the dispute appears once the indexer confirms."
      >
        <Check className="h-4 w-4" /> Dispute filed
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-danger/40 bg-surface px-4 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft"
      >
        <Scale className="h-4 w-4" /> {VERB}
      </button>

      <Modal
        open={open}
        onClose={close}
        busy={busy}
        label={VERB}
        subtitle={<p className="font-mono text-[11px] text-muted-2">dispute::initialize_dispute</p>}
        footer={
          done ? undefined : (
            <>
              <button
                onClick={close}
                disabled={busy}
                className="rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
              >
                Cancel
              </button>
              {!connected ? (
                <button onClick={connect} className="inline-flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                  <Wallet className="h-4 w-4" /> Connect wallet
                </button>
              ) : failed ? (
                <button onClick={() => reset()} className="inline-flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                  Try again
                </button>
              ) : (
                <button
                  onClick={handleRun}
                  disabled={busy || uploading || bondInvalid}
                  className="inline-flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                  {busy ? TX_STATUS_LABEL[status] : `Confirm ${VERB.toLowerCase()}`}
                </button>
              )}
            </>
          )
        }
      >
        {done ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-positive-soft text-positive">
              <Check className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-foreground">{VERB} confirmed</p>
            {result?.digest && <p className="font-mono text-xs text-muted">{shortDigest(result.digest)}</p>}
            {intentRoute(baseIntent) && (
              <Link href={intentRoute(baseIntent)!} onClick={close} className="text-xs font-semibold text-primary hover:text-primary-strong">
                View details →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">{intentSummary(baseIntent)}</p>

            {/* Reason */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Reason</label>
              <textarea
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why is this attestation being challenged?"
                className="w-full resize-none rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-border-strong"
              />
            </div>

            {/* Evidence → Walrus */}
            <div>
              <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
                <span>Evidence <span className="text-muted-2">(optional)</span></span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-2" title="The file is uploaded to Walrus and its sha256 is computed in your browser; the blob id + hash are pinned on-chain.">
                  <Shield className="h-3 w-3" /> Walrus + sha256
                </span>
              </label>
              <input ref={fileRef} type="file" disabled={busy || uploading} onChange={onPickFile} className="block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground hover:file:bg-surface-2" />

              {uploading && (
                <p className="mt-2 inline-flex items-center gap-2 text-[11px] text-muted">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> Uploading to Walrus…
                </p>
              )}
              {ev.status === "done" && (
                <div className="mt-2 rounded-lg border border-positive/30 bg-positive-soft px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-1.5 font-medium text-positive">
                    <Doc className="h-3.5 w-3.5" /> {ev.name} — pinned on Walrus
                  </div>
                  <div className="mt-1 truncate font-mono text-muted-2" title={ev.blobId}>blob {ev.blobId}</div>
                  <div className="truncate font-mono text-muted-2" title={ev.sha256}>sha256 {shortHash(ev.sha256)}</div>
                </div>
              )}
              {ev.status === "error" && (
                <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] text-danger">
                  <Alert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {ev.msg}. You can still file with a reason only.
                </p>
              )}
            </div>

            {/* Bond stake */}
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="text-muted">Challenger bond (staked)</span>
              <span className="tnum font-semibold text-foreground">{usd(bond)}</span>
            </div>

            {bondInvalid && <p className="text-[11px] text-danger">Challenger bond is unavailable — try again shortly.</p>}

            {failed && (
              <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                <Alert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{result?.error ?? "Transaction failed."}</span>
              </div>
            )}

            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-2">
              {isLive
                ? `Live execution — this submits a real transaction to ${SUI_NETWORK} and your wallet will ask you to sign. The evidence blob is real Walrus.`
                : "Mock execution — no transaction is submitted, but an attached evidence file IS uploaded to real Walrus and hashed in your browser."}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
