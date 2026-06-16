//! Keypairs + Sui address derivation + transaction signing.
//!
//! - Fake-user keypairs (SIM-D5): load-or-generate `USER_COUNT` ed25519 keys and
//!   persist their seeds so addresses are **stable across restarts** (SI-5).
//! - Operator key: parsed from `OPERATOR_KEY` in the Sui keystore base64 form
//!   (`base64(flag || privkey)`), used to sign re-seed transactions.
//! - Sui address = `0x` + hex(Blake2b-256(flag || pubkey)); ed25519 flag = 0x00.
//! - Sui signature = `base64(flag || ed25519_sig || pubkey)` over the
//!   Blake2b-256 of the intent message (`intent(3) || tx_bytes`).

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::fs;

type Blake2b256 = Blake2b<U32>;

/// Sui signature-scheme flag for ed25519.
pub const FLAG_ED25519: u8 = 0x00;

/// An ed25519 keypair plus its derived Sui address.
pub struct Keypair {
    signing: SigningKey,
    pub address: String,
}

impl Keypair {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        let signing = SigningKey::from_bytes(&seed);
        let address = sui_address(&signing.verifying_key().to_bytes());
        Keypair { signing, address }
    }

    fn public_key(&self) -> [u8; 32] {
        self.signing.verifying_key().to_bytes()
    }

    fn seed(&self) -> [u8; 32] {
        self.signing.to_bytes()
    }

    /// Produce a Sui serialized signature (base64 of `flag || sig || pubkey`) over
    /// the given intent message (`intent(3) || tx_bytes`). Sui signs the
    /// Blake2b-256 digest of that message.
    pub fn sign_intent(&self, intent_message: &[u8]) -> String {
        let mut hasher = Blake2b256::new();
        hasher.update(intent_message);
        let digest = hasher.finalize();

        let sig = self.signing.sign(&digest);

        let mut out = Vec::with_capacity(1 + 64 + 32);
        out.push(FLAG_ED25519);
        out.extend_from_slice(&sig.to_bytes());
        out.extend_from_slice(&self.public_key());
        STANDARD.encode(out)
    }
}

/// Derive a Sui address from an ed25519 public key.
pub fn sui_address(pubkey: &[u8; 32]) -> String {
    let mut hasher = Blake2b256::new();
    hasher.update([FLAG_ED25519]);
    hasher.update(pubkey);
    let digest = hasher.finalize();
    format!("0x{}", hex::encode(digest))
}

/// Parse `OPERATOR_KEY` from the Sui keystore base64 form: `base64(flag || privkey)`.
/// (Get it from `~/.sui/sui_config/sui.keystore` — one entry per managed address.)
pub fn operator_from_b64(s: &str) -> Result<Keypair> {
    let raw = STANDARD
        .decode(s.trim())
        .context("OPERATOR_KEY is not valid base64 (expected sui.keystore form base64(flag||privkey))")?;
    if raw.len() != 33 {
        return Err(anyhow!(
            "OPERATOR_KEY must decode to 33 bytes (flag||privkey), got {}",
            raw.len()
        ));
    }
    if raw[0] != FLAG_ED25519 {
        return Err(anyhow!(
            "OPERATOR_KEY flag 0x{:02x} unsupported (only ed25519 0x00)",
            raw[0]
        ));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&raw[1..33]);
    Ok(Keypair::from_seed(seed))
}

#[derive(Serialize, Deserialize)]
struct StoredKey {
    seed_hex: String,
}

#[derive(Serialize, Deserialize, Default)]
struct UserStore {
    users: Vec<StoredKey>,
}

/// Load `count` fake-user keypairs from `path`, generating + persisting any that
/// are missing. Restart-safe: existing seeds reload to identical addresses.
pub fn load_or_generate_users(path: &str, count: usize) -> Result<Vec<Keypair>> {
    let mut store: UserStore = match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).context("parsing user key store")?,
        Err(_) => UserStore::default(),
    };

    let mut keys = Vec::with_capacity(count);
    let mut dirty = false;

    for i in 0..count {
        if let Some(stored) = store.users.get(i) {
            let bytes = hex::decode(&stored.seed_hex).context("bad seed hex in user store")?;
            if bytes.len() != 32 {
                return Err(anyhow!("stored seed #{i} is not 32 bytes"));
            }
            let mut seed = [0u8; 32];
            seed.copy_from_slice(&bytes);
            keys.push(Keypair::from_seed(seed));
        } else {
            let kp = generate()?;
            store.users.push(StoredKey {
                seed_hex: hex::encode(kp.seed()),
            });
            keys.push(kp);
            dirty = true;
        }
    }

    if dirty {
        fs::write(path, serde_json::to_string_pretty(&store)?)
            .with_context(|| format!("persisting user keys to {path}"))?;
    }
    Ok(keys)
}

fn generate() -> Result<Keypair> {
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|e| anyhow!("OS RNG failed: {e}"))?;
    Ok(Keypair::from_seed(seed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_address_shape() {
        let kp = Keypair::from_seed([7u8; 32]);
        assert!(kp.address.starts_with("0x"));
        assert_eq!(kp.address.len(), 66); // 0x + 32 bytes hex
    }

    #[test]
    fn test_keys_stable_across_load() {
        let path = std::env::temp_dir()
            .join(format!("gally_sim_users_test_{}.json", std::process::id()));
        let p = path.to_str().unwrap();
        let _ = std::fs::remove_file(p);

        let first: Vec<String> = load_or_generate_users(p, 4)
            .unwrap()
            .iter()
            .map(|k| k.address.clone())
            .collect();
        let second: Vec<String> = load_or_generate_users(p, 4)
            .unwrap()
            .iter()
            .map(|k| k.address.clone())
            .collect();

        assert_eq!(first.len(), 4);
        assert_eq!(first, second, "reloaded user addresses must be identical");

        let _ = std::fs::remove_file(p);
    }
}
