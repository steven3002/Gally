// FE-M8a — Resilient HTTP client for the BI-M8 indexer.
//
// Centralizes the base URL, a per-request timeout, cursor-envelope unwrapping, and
// the graceful-degradation contract: a failed/timed-out request throws `IndexerError`,
// which the live source catches and turns into the FE-M7 empty/error states (never a
// crash). No retries here — the caller decides fallback.

import type { Envelope } from "./wire";

// Absolute base — used server-side (SSR fetches the co-located indexer on localhost)
// and by the WebSocket client (rewrites can't proxy WS).
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:8088").replace(/\/$/, "");
// Same-origin path the BROWSER uses — proxied to the indexer by the Next rewrite in
// `next.config.ts`. This is what makes client-side live reads work over an SSH tunnel
// (the browser only ever hits the frontend origin, never `127.0.0.1:8088` directly).
const INDEXER_PROXY_PATH = (process.env.NEXT_PUBLIC_INDEXER_PROXY_PATH ?? "/_idx").replace(/\/$/, "");
/** Resolve the request base by execution context: relative (same-origin) in the browser, absolute on the server. */
function baseUrl(): string {
  return typeof window === "undefined" ? INDEXER_URL : INDEXER_PROXY_PATH;
}
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
  const url = `${baseUrl()}${path}`;
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
