//! Thin Sui JSON-RPC client over `ureq` (sync). Only what SIM-M2 needs: read an
//! object's fields, read a SUI balance, the chain id, and a build→sign→submit
//! path for a single Move call (`unsafe_moveCall` + `sui_executeTransactionBlock`).
//!
//! Wire-type note (guard_rails R2): `u64`/`u128` arrive as JSON **strings**;
//! object ids and addresses as `0x…` strings.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

use crate::keys::Keypair;

/// Intent prefix for `TransactionData` (scope=0, version=0, app=0=Sui).
const INTENT_TX_DATA: [u8; 3] = [0, 0, 0];

pub struct SuiClient {
    rpc_url: String,
    agent: ureq::Agent,
}

/// Decoded `MockFaucet` view fields (all μUSDC counters).
pub struct FaucetState {
    pub reservoir: u64,
    pub allocation: u64,
    pub low_water_mark: u64,
    pub total_claimed: u64,
    pub claim_count: u64,
}

impl SuiClient {
    pub fn new(rpc_url: &str) -> Self {
        SuiClient {
            rpc_url: rpc_url.to_string(),
            agent: ureq::agent(),
        }
    }

    fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let text = self
            .agent
            .post(&self.rpc_url)
            .set("Content-Type", "application/json")
            .send_string(&body.to_string())
            .map_err(|e| anyhow!("RPC {method} transport error: {e}"))?
            .into_string()
            .with_context(|| format!("reading RPC {method} response body"))?;
        let resp: Value =
            serde_json::from_str(&text).with_context(|| format!("RPC {method} response not JSON"))?;
        if let Some(err) = resp.get("error") {
            return Err(anyhow!("RPC {method} error: {err}"));
        }
        resp.get("result")
            .cloned()
            .ok_or_else(|| anyhow!("RPC {method}: no result field"))
    }

    pub fn chain_identifier(&self) -> Result<String> {
        let r = self.rpc("sui_getChainIdentifier", json!([]))?;
        r.as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("chain id is not a string"))
    }

    /// `content.fields` of a Move object, or a clear error if it is missing.
    pub fn get_object_fields(&self, id: &str) -> Result<Value> {
        let r = self.rpc("sui_getObject", json!([id, { "showContent": true }]))?;
        r.pointer("/data/content/fields")
            .cloned()
            .ok_or_else(|| anyhow!("object {id}: no content.fields (not found / not a Move object)"))
    }

    pub fn read_faucet(&self, faucet_id: &str) -> Result<FaucetState> {
        let f = self.get_object_fields(faucet_id)?;
        let field_u64 = |k: &str| -> Result<u64> {
            f.get(k)
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("MockFaucet field '{k}' missing or not a string"))?
                .parse::<u64>()
                .with_context(|| format!("parsing MockFaucet field '{k}'"))
        };
        Ok(FaucetState {
            reservoir: field_u64("reservoir")?,
            allocation: field_u64("allocation")?,
            low_water_mark: field_u64("low_water_mark")?,
            total_claimed: field_u64("total_claimed")?,
            claim_count: field_u64("claim_count")?,
        })
    }

    pub fn sui_balance(&self, address: &str) -> Result<u64> {
        let r = self.rpc("suix_getBalance", json!([address, "0x2::sui::SUI"]))?;
        r.get("totalBalance")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("getBalance: no totalBalance"))?
            .parse::<u64>()
            .context("parsing totalBalance")
    }

    /// Build (`unsafe_moveCall`) → sign → execute one Move call. Returns the full
    /// execution result `Value` (effects + events) on success; errors on a
    /// non-`success` status.
    pub fn move_call_signed(
        &self,
        signer: &Keypair,
        sender: &str,
        package: &str,
        module: &str,
        function: &str,
        type_args: Vec<String>,
        call_args: Vec<Value>,
        gas_budget: u64,
    ) -> Result<Value> {
        // 1. node builds the TransactionData bytes (picks gas coin).
        let build = self.rpc(
            "unsafe_moveCall",
            json!([
                sender, package, module, function, type_args, call_args,
                Value::Null, gas_budget.to_string(), Value::Null
            ]),
        )?;
        let tx_bytes_b64 = build
            .get("txBytes")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("unsafe_moveCall: no txBytes"))?
            .to_string();

        // 2. sign Blake2b256(intent || tx_bytes).
        let tx_bytes = STANDARD
            .decode(&tx_bytes_b64)
            .context("decoding txBytes base64")?;
        let mut intent_msg = Vec::with_capacity(INTENT_TX_DATA.len() + tx_bytes.len());
        intent_msg.extend_from_slice(&INTENT_TX_DATA);
        intent_msg.extend_from_slice(&tx_bytes);
        let signature = signer.sign_intent(&intent_msg);

        // 3. execute and wait for local execution.
        let exec = self.rpc(
            "sui_executeTransactionBlock",
            json!([
                tx_bytes_b64,
                [signature],
                { "showEffects": true, "showEvents": true },
                "WaitForLocalExecution"
            ]),
        )?;
        let status = exec
            .pointer("/effects/status/status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        if status != "success" {
            let detail = exec
                .pointer("/effects/status/error")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            return Err(anyhow!("{module}::{function} tx status={status}: {detail}"));
        }
        Ok(exec)
    }
}

/// First address-owned object created by a transaction (the minted coin, for
/// re-seed). Returns its object id.
pub fn first_created_owned_object(exec: &Value) -> Option<String> {
    let created = exec.pointer("/effects/created")?.as_array()?;
    for c in created {
        if c.pointer("/owner/AddressOwner").is_some() {
            if let Some(id) = c.pointer("/reference/objectId").and_then(|v| v.as_str()) {
                return Some(id.to_string());
            }
        }
    }
    None
}
