"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { protocolConfig } from "@/lib/mock/data";
import { cn } from "@/lib/format";
import { Alert } from "@/components/ui/icons";

/* The global pause banner reflects `ProtocolConfig.paused` (D6). The live fixture
 * ships `paused: false`; flipping it to `true` shows the banner app-wide. To let
 * the banner be *demonstrated* without editing source (it's a read-only explorer),
 * a client-side preview flag in localStorage also drives it — a pure UI preview
 * that fabricates no protocol state (the governance page toggles it). */

const KEY = "gally:pausePreview";
const EVENT = "gally-pause-preview-change";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Toggle the preview flag (governance-page affordance). */
export function setPausePreview(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

/** Reactive preview flag. Server/first-client render is `false` → no hydration drift. */
export function usePausePreview(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function PauseBanner() {
  const preview = usePausePreview();
  const paused = protocolConfig.paused || preview;
  if (!paused) return null;
  const isPreview = !protocolConfig.paused && preview;

  return (
    <div className="border-b border-danger/30 bg-danger-soft" role="status">
      <div className="mx-auto flex w-full max-w-[1400px] items-start gap-3 px-4 py-2.5 lg:px-8">
        <Alert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <p className="text-xs text-foreground">
          <span className="font-semibold text-danger">Protocol paused.</span>{" "}
          Capital entry is halted (new contributions, wraps) — but every exit stays open: refunds,
          claims, unwraps, redemptions and dispute resolution are never pause-gated.{" "}
          <Link href="/governance" className="font-medium text-danger underline">
            Governance
          </Link>
          {isPreview && <span className="ml-1 text-muted-2">· preview — the live config is not actually paused</span>}
        </p>
      </div>
    </div>
  );
}

/** Inline toggle for the governance page to demonstrate the global pause banner. */
export function PausePreviewToggle() {
  const preview = usePausePreview();
  const on = protocolConfig.paused || preview;
  return (
    <button
      type="button"
      onClick={() => setPausePreview(!preview)}
      disabled={protocolConfig.paused}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
        on
          ? "border-danger/40 bg-danger-soft text-danger"
          : "border-border bg-surface text-muted hover:text-foreground",
        protocolConfig.paused && "cursor-not-allowed opacity-70",
      )}
      title="Preview the global pause banner (does not change protocol state)"
    >
      <span className={cn("h-2 w-2 rounded-full", on ? "bg-danger" : "bg-muted-2")} />
      {protocolConfig.paused ? "Paused (live)" : preview ? "Previewing pause banner" : "Preview pause banner"}
    </button>
  );
}
