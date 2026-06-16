//! Build a multi-command **Programmable Transaction Block** (claim+transfer,
//! contribute+transfer-change, mint→register, mint→create, walrus-vec→vouch) by
//! shelling out to `sui client ptb --serialize-unsigned-transaction`.
//!
//! Why shell the CLI instead of `unsafe_moveCall`: `unsafe_moveCall` is a *single*
//! `MoveCall` command, so it can't transfer a returned `Coin` (the faucet `claim`
//! and `contribute_capital` both return a coin with no `drop` — bare calls abort
//! `UnusedValueWithoutDrop`) nor build a `vector<WalrusRef>` for `vouch`. The CLI
//! `ptb` builder serialises a full PTB; `--sender` lets us build for **any**
//! address whose key we hold out-of-band, so **no keystore import is needed** — we
//! sign the returned bytes in-process ([`crate::keys`]) and submit over RPC.
//!
//! The CLI uses its **active environment** for RPC + gas-coin selection, so the
//! active env must point at the same local node as `RPC_URL` (`sui client envs`).

use anyhow::{anyhow, Context, Result};
use std::process::Command;

/// Serialise an unsigned `TransactionData` (base64) for `sender`, given the PTB
/// command tokens (everything after `sui client ptb`, except `--sender`,
/// `--gas-budget`, and the trailing `--serialize-unsigned-transaction`, which we
/// add). Each element of `args` is one argv token (no shell quoting — vector
/// literals like `vector[1u8,2u8]` are passed whole).
pub fn build_unsigned(sender: &str, gas_budget: u64, args: &[String]) -> Result<String> {
    let mut cmd = Command::new("sui");
    cmd.arg("client")
        .arg("ptb")
        .arg("--sender")
        .arg(sender)
        .arg("--gas-budget")
        .arg(gas_budget.to_string());
    for a in args {
        cmd.arg(a);
    }
    cmd.arg("--serialize-unsigned-transaction");

    let out = cmd
        .output()
        .context("running `sui client ptb` (is the sui CLI on PATH and an env active?)")?;
    if !out.status.success() {
        return Err(anyhow!(
            "`sui client ptb` failed ({}):\nstderr: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    extract_tx_bytes(&stdout)
        .ok_or_else(|| anyhow!("no serialized tx bytes in `sui client ptb` output:\n{stdout}"))
}

/// The serialised bytes are the longest base64-charset token in the output —
/// far longer (hundreds of chars) than any `0x…` id, label, or table glyph.
fn extract_tx_bytes(s: &str) -> Option<String> {
    s.split(|c: char| c.is_whitespace())
        .filter(|t| t.len() > 80 && t.bytes().all(is_b64_char))
        .max_by_key(|t| t.len())
        .map(|t| t.to_string())
}

fn is_b64_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'='
}

#[cfg(test)]
mod tests {
    use super::extract_tx_bytes;

    #[test]
    fn test_extract_tx_bytes_picks_longest_b64() {
        // A realistic-ish dump: an id, some prose, then the long base64 blob.
        let blob = "AAACAAh".repeat(40); // > 80 base64 chars, no padding issues
        let dump = format!(
            "Transaction sender 0x{}\nSerialized:\n{}\n",
            "ab".repeat(32),
            blob
        );
        assert_eq!(extract_tx_bytes(&dump).as_deref(), Some(blob.as_str()));
    }

    #[test]
    fn test_extract_tx_bytes_none_when_short() {
        assert!(extract_tx_bytes("no base64 here, just 0x1234 short tokens").is_none());
    }
}
