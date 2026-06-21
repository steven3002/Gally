// Real Walrus testnet integration — **frontend-only** (the bot/backend keep the
// mock-Walrus stand-in). The chain stores a `WalrusRef { blob_id, sha256 }` whose
// bytes are caller-supplied; here we make those bytes real:
//   • upload   → PUT the file to a Walrus *publisher*, get a genuine `blobId`;
//   • hash     → sha256 in the browser (WebCrypto), so the on-chain pin is computed
//                independently of the publisher (A13 tamper-evidence);
//   • verify   → GET from a Walrus *aggregator*, recompute sha256, compare.
//
// Endpoints are env-overridable; the defaults are Mysten's public Walrus testnet
// gateways (CORS-open, so the browser uploads/fetches directly — no proxy, no
// backend involvement). Everything degrades gracefully: a missing/expired/mock blob
// resolves to "unavailable", never a hard crash.

const PUBLISHER =
  process.env.NEXT_PUBLIC_WALRUS_PUBLISHER ?? "https://publisher.walrus-testnet.walrus.space";
const AGGREGATOR =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR ?? "https://aggregator.walrus-testnet.walrus.space";
/** Storage epochs to pay for on upload (demo blobs; the operator funds the publisher). */
const DEFAULT_EPOCHS = Number(process.env.NEXT_PUBLIC_WALRUS_EPOCHS ?? "5");

export const WALRUS_PUBLISHER = PUBLISHER;
export const WALRUS_AGGREGATOR = AGGREGATOR;

/** Public open/download URL for a blob id (real blobs resolve; mock ids 404). */
export function walrusUrl(blobId: string): string {
  return `${AGGREGATOR}/v1/blobs/${encodeURIComponent(normalizeBlobId(blobId))}`;
}

/** sha256(bytes) → lowercase hex (no `0x`). WebCrypto (browser + Node ≥18). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface WalrusUpload {
  blobId: string;
  /** lowercase hex sha256 of the uploaded bytes (computed locally). */
  sha256: string;
  size: number;
}

/**
 * Upload bytes to the Walrus publisher and return the real `blobId` + the locally
 * computed `sha256`. Walrus is content-addressed, so re-uploading identical bytes is
 * idempotent (`alreadyCertified`). Throws on a non-2xx publisher response.
 */
export async function uploadBlob(bytes: Uint8Array, epochs = DEFAULT_EPOCHS): Promise<WalrusUpload> {
  const sha256 = await sha256Hex(bytes);
  const res = await fetch(`${PUBLISHER}/v1/blobs?epochs=${epochs}`, {
    method: "PUT",
    body: bytes as BodyInit,
  });
  if (!res.ok) {
    throw new Error(`Walrus upload failed (HTTP ${res.status})`);
  }
  const json = await res.json().catch(() => null);
  const blobId: string | undefined =
    json?.newlyCreated?.blobObject?.blobId ?? json?.alreadyCertified?.blobId;
  if (!blobId) {
    throw new Error("Walrus upload returned no blob id");
  }
  return { blobId, sha256, size: bytes.length };
}

export type VerifyStatus = "verified" | "mismatch" | "unavailable";
export interface VerifyResult {
  status: VerifyStatus;
  /** the recomputed hex sha256 (present when the blob was fetched). */
  computed?: string;
}

/**
 * Fetch a blob from the aggregator, recompute its sha256, and compare to the on-chain
 * hash. A 404 / network error / expired blob (incl. all mock ids) returns
 * `"unavailable"` — never throws — so the UI can show "couldn't verify" rather than
 * silently trusting an unverified file.
 */
export async function fetchAndVerify(blobId: string, expectedSha256: string): Promise<VerifyResult> {
  let res: Response;
  try {
    res = await fetch(walrusUrl(blobId), { method: "GET" });
  } catch {
    return { status: "unavailable" };
  }
  if (!res.ok) return { status: "unavailable" };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const computed = await sha256Hex(bytes);
  return { status: computed === stripHex(expectedSha256) ? "verified" : "mismatch", computed };
}

function stripHex(s: string): string {
  return (s.startsWith("0x") ? s.slice(2) : s).toLowerCase();
}

/**
 * On-chain blob ids are `vector<u8>` — the indexer hands them back hex-encoded, but a
 * REAL Walrus blob id is a base64url STRING. If `raw` is hex of printable ASCII,
 * decode it back to that string; otherwise return it unchanged (already a string:
 * mock fixtures, or a base64url id that contains non-hex chars like `-`/`_`).
 */
export function normalizeBlobId(raw: string): string {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (hex.length >= 8 && hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex)) {
    const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16));
    if (bytes.every((b) => b >= 0x20 && b < 0x7f)) {
      return String.fromCharCode(...bytes);
    }
  }
  return raw;
}
