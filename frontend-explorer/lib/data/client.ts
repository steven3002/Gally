// FE-M8a — Resilient HTTP client for the BI-M8 indexer.
//
// Centralizes the base URL, a per-request timeout, cursor-envelope unwrapping, and
// the graceful-degradation contract: a failed/timed-out request throws `IndexerError`,
// which the live source catches and turns into the FE-M7 empty/error states (never a
// crash). No retries here — the caller decides fallback.

import type { Envelope } from "./wire";

export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:8088").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_INDEXER_TIMEOUT_MS ?? 6000);

export class IndexerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = "IndexerError";
  }
}

/** GET a JSON resource. Returns `null` on 404; throws `IndexerError` otherwise. */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const url = `${INDEXER_URL}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  // Chain an external abort into our controller.
  if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new IndexerError(`indexer ${res.status} for ${path}`, res.status, path);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof IndexerError) throw e;
    const msg = e instanceof Error && e.name === "AbortError" ? `indexer timeout for ${path}` : `indexer unreachable for ${path}`;
    throw new IndexerError(msg, undefined, path);
  } finally {
    clearTimeout(timer);
  }
}

/** GET a paginated collection, returning just the `data[]` (one page). */
export async function getList<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const env = await getJson<Envelope<T>>(path, signal);
  return env?.data ?? [];
}

/** GET a paginated collection, returning the full envelope (for extra fields). */
export async function getEnvelope<E>(path: string, signal?: AbortSignal): Promise<E | null> {
  return getJson<E>(path, signal);
}
