//! SIM-M6 — deterministic **mock-Walrus** resolver artifact (LI-Q3 resolution).
//!
//! The bot does **not** upload to a real Walrus network in local sim (R6: the bot runs no server,
//! and there is no Walrus on a `--force-regenesis` node). Instead it writes a static
//! `walrus_blobs.json` mapping every on-chain `metadata_blob_id` (hex) → the rich JSON document and
//! its `sha256` (hex). The frontend's sim-mode data layer (FE-M8) fetches a blob by id from this
//! file and recomputes `sha256(doc)` to verify it against the on-chain `WalrusRef.sha256` — so
//! "view document / verify sha256" resolves exactly as it will against real Walrus on testnet
//! (LI-Q3: "real upload reserved for testnet").
//!
//! The artifact is purely derived from [`crate::catalog`] (deterministic, idempotent — a re-run
//! overwrites with identical bytes), so it is safe to write on every seed.

use std::path::Path;

use anyhow::{Context, Result};

use crate::catalog::{self, Project};

/// One resolvable blob entry, keyed in the output map by its hex `blob_id`.
fn entry_json(p: &Project) -> String {
    let sha_hex = hex::encode(catalog::blob_sha256(p));
    // `doc` is embedded as a JSON string (the frontend parses + re-hashes its bytes to verify).
    let doc = catalog::blob_doc(p);
    let doc_escaped = doc.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"sha256\":\"{sha_hex}\",\"doc\":\"{doc_escaped}\"")
}

/// Serialize the full `blob_id_hex → { sha256, doc }` map (deterministic key order = catalog order).
pub fn render_blob_map() -> String {
    let mut out = String::from("{\n");
    for (i, p) in catalog::PROJECTS.iter().enumerate() {
        let blob_hex = hex::encode(catalog::blob_id_bytes(p));
        let comma = if i + 1 < catalog::PROJECTS.len() { "," } else { "" };
        out.push_str(&format!("  \"{}\": {{{}}}{}\n", blob_hex, entry_json(p), comma));
    }
    out.push('}');
    out
}

/// Write `walrus_blobs.json` (LI-Q3). Idempotent — identical bytes on every run.
pub fn write_blob_map(path: &Path) -> Result<()> {
    std::fs::write(path, render_blob_map())
        .with_context(|| format!("writing mock-Walrus blob map to {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn test_blob_map_resolves_and_verifies() {
        let map = render_blob_map();
        // Every project's blob id is present, keyed by hex.
        for p in catalog::PROJECTS {
            let blob_hex = hex::encode(catalog::blob_id_bytes(p));
            assert!(map.contains(&blob_hex), "blob id {blob_hex} present in the map");

            // The embedded sha256 equals sha256(doc) — i.e. it actually verifies.
            let mut h = Sha256::new();
            h.update(catalog::blob_doc(p).as_bytes());
            let recomputed = hex::encode::<[u8; 32]>(h.finalize().into());
            assert!(map.contains(&recomputed), "sha256 of doc matches the stored digest");
        }
        // Valid JSON object shape.
        assert!(map.starts_with('{') && map.trim_end().ends_with('}'));
    }
}
