import { describe, it, expect } from "vitest";
import { sha256Hex, normalizeBlobId, walrusUrl, WALRUS_AGGREGATOR } from "./client";

const enc = (s: string) => new TextEncoder().encode(s);
const toHex = (s: string) =>
  [...enc(s)].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("walrus sha256Hex", () => {
  it("matches the known vectors", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex(enc("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("walrus normalizeBlobId", () => {
  it("decodes hex-encoded (indexer) ids back to the real base64url string", () => {
    const real = "UIUpg56BZlB4SojQPwVqhuxJusq-KT4OXwV0WBRoYDo";
    expect(normalizeBlobId(toHex(real))).toBe(real);
    expect(normalizeBlobId("0x" + toHex(real))).toBe(real);
  });

  it("leaves a real base64url id (non-hex chars) unchanged", () => {
    const real = "UIUpg56BZlB4SojQPwVqhuxJusq-KT4OXwV0WBRoYDo";
    expect(normalizeBlobId(real)).toBe(real);
  });

  it("leaves mock fixture ids unchanged", () => {
    expect(normalizeBlobId("blob_deadbeef")).toBe("blob_deadbeef");
  });

  it("builds an aggregator URL", () => {
    const real = "UIUpg56BZlB4SojQPwVqhuxJusq-KT4OXwV0WBRoYDo";
    expect(walrusUrl(real)).toBe(`${WALRUS_AGGREGATOR}/v1/blobs/${encodeURIComponent(real)}`);
  });
});
