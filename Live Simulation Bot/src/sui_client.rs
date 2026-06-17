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

/// One address-owned object (id + its full Move type string).
#[derive(Debug, Clone)]
pub struct OwnedObject {
    pub id: String,
    pub type_: String,
}

/// One `Coin<T>` owned by an address.
#[derive(Debug, Clone)]
pub struct CoinObject {
    pub id: String,
    pub balance: u64,
}

/// Decoded `Asset` view fields used by the activity selectors (`[CORE] §3`).
#[derive(Debug, Clone)]
pub struct AssetView {
    pub state: u8,
    pub raised: u64,
    pub funding_goal: u64,
    pub coverage_locked: u64,
    pub disputed: bool,
    pub next_tranche: u64,
    pub accumulator_id: Option<String>,
    pub validator_pool_id: Option<String>,
    /// Per-tranche `(deadline_ms, released, has_proof, approved)` in order.
    pub tranches: Vec<TrancheView>,
}

#[derive(Debug, Clone)]
pub struct TrancheView {
    pub deadline_ms: u64,
    pub released: bool,
    pub has_proof: bool,
    pub approved: bool,
}

/// Decoded `GlobalYieldAccumulator<T>` view fields (`[CORE] §3`).
#[derive(Debug, Clone)]
pub struct AccumulatorView {
    pub total_minted_shares: u64,
    pub total_wrapped_shares: u64,
    pub rollover_reserve: u64,
    pub compensation_pool: u64,
    pub compensation_unlock_ms: u64,
    pub closed: bool,
}

impl AccumulatorView {
    /// The yield-earning denominator (`unwrapped = minted − wrapped`).
    pub fn unwrapped_supply(&self) -> u64 {
        self.total_minted_shares.saturating_sub(self.total_wrapped_shares)
    }
}

/// Decoded `ValidatorPool` view fields (`[CORE] §3`).
#[derive(Debug, Clone)]
pub struct PoolView {
    pub stake: u64,
    pub locked: u64,
    pub active_vouches: u64,
    pub status: u8, // 0 ACTIVE | 1 FROZEN | 2 SLASHED
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

    /// `(state, raised, funding_goal)` of an `Asset` (μUSDC). `state` is a `u8`
    /// (FUNDING = 1, …); `raised`/`funding_goal` arrive as JSON strings (R2).
    pub fn asset_view(&self, asset_id: &str) -> Result<(u8, u64, u64)> {
        let f = self.get_object_fields(asset_id)?;
        let state = f
            .get("state")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| anyhow!("Asset {asset_id}: no u8 'state' field"))? as u8;
        let u64f = |k: &str| -> Result<u64> {
            f.get(k)
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("Asset {asset_id}: field '{k}' missing or not a string"))?
                .parse::<u64>()
                .with_context(|| format!("parsing Asset field '{k}'"))
        };
        Ok((state, u64f("raised")?, u64f("funding_goal")?))
    }

    /// Full `Asset` view (state, escrow, tranches, dispute flag, ids) for the
    /// activity selectors. All `u64` arrive as JSON strings (R2); `Option<ID>`
    /// renders as the bare id or `null`; `vector<Tranche>` as an array.
    pub fn asset_full_view(&self, asset_id: &str) -> Result<AssetView> {
        let f = self.get_object_fields(asset_id)?;
        let state = f
            .get("state")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| anyhow!("Asset {asset_id}: no u8 'state'"))? as u8;
        let u64f = |k: &str| -> u64 { parse_u64_field(&f, k).unwrap_or(0) };

        let tranches = f
            .get("tranches")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|t| {
                        let tf = t.get("fields").unwrap_or(t);
                        TrancheView {
                            deadline_ms: parse_u64_field(tf, "deadline_ms").unwrap_or(0),
                            released: tf.get("released").and_then(|v| v.as_bool()).unwrap_or(false),
                            has_proof: option_is_some(tf.get("proof")),
                            approved: option_is_some(tf.get("approved_by")),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(AssetView {
            state,
            raised: u64f("raised"),
            funding_goal: u64f("funding_goal"),
            coverage_locked: u64f("coverage_locked"),
            disputed: f.get("disputed").and_then(|v| v.as_bool()).unwrap_or(false),
            next_tranche: u64f("next_tranche"),
            accumulator_id: option_id(f.get("accumulator_id")),
            validator_pool_id: option_id(f.get("validator_pool_id")),
            tranches,
        })
    }

    /// `GlobalYieldAccumulator<T>` view. `Balance<T>` fields render as a bare
    /// string number; `cumulative_yield_index` is a u128 string.
    pub fn accumulator_view(&self, acc_id: &str) -> Result<AccumulatorView> {
        let f = self.get_object_fields(acc_id)?;
        Ok(AccumulatorView {
            total_minted_shares: parse_u64_field(&f, "total_minted_shares").unwrap_or(0),
            total_wrapped_shares: parse_u64_field(&f, "total_wrapped_shares").unwrap_or(0),
            rollover_reserve: parse_balance_field(&f, "rollover_reserve"),
            compensation_pool: parse_balance_field(&f, "compensation_pool"),
            compensation_unlock_ms: parse_u64_field(&f, "compensation_unlock_ms").unwrap_or(0),
            closed: f.get("closed").and_then(|v| v.as_bool()).unwrap_or(false),
        })
    }

    /// `ValidatorPool` view (stake/locked/active_vouches/status).
    pub fn pool_view(&self, pool_id: &str) -> Result<PoolView> {
        let f = self.get_object_fields(pool_id)?;
        Ok(PoolView {
            stake: parse_balance_field(&f, "stake"),
            locked: parse_u64_field(&f, "locked").unwrap_or(0),
            active_vouches: parse_u64_field(&f, "active_vouches").unwrap_or(0),
            status: f.get("status").and_then(|v| v.as_u64()).unwrap_or(0) as u8,
        })
    }

    /// All address-owned objects (one page, up to `limit`), with their full
    /// Move type strings — the per-user object scan (shares/coins/receipts).
    pub fn owned_objects(&self, owner: &str, limit: u64) -> Result<Vec<OwnedObject>> {
        let r = self.rpc(
            "suix_getOwnedObjects",
            json!([owner, { "options": { "showType": true } }, Value::Null, limit]),
        )?;
        let data = r.get("data").and_then(|v| v.as_array());
        let mut out = Vec::new();
        if let Some(arr) = data {
            for e in arr {
                let id = e.pointer("/data/objectId").and_then(|v| v.as_str());
                let ty = e.pointer("/data/type").and_then(|v| v.as_str());
                if let (Some(id), Some(ty)) = (id, ty) {
                    out.push(OwnedObject { id: id.to_string(), type_: ty.to_string() });
                }
            }
        }
        Ok(out)
    }

    /// `Coin<coin_type>` objects owned by `owner` (one page).
    pub fn get_coins(&self, owner: &str, coin_type: &str, limit: u64) -> Result<Vec<CoinObject>> {
        let r = self.rpc(
            "suix_getCoins",
            json!([owner, coin_type, Value::Null, limit]),
        )?;
        let mut out = Vec::new();
        if let Some(arr) = r.get("data").and_then(|v| v.as_array()) {
            for c in arr {
                let id = c.get("coinObjectId").and_then(|v| v.as_str());
                let bal = c
                    .get("balance")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<u64>().ok());
                if let (Some(id), Some(bal)) = (id, bal) {
                    out.push(CoinObject { id: id.to_string(), balance: bal });
                }
            }
        }
        Ok(out)
    }

    /// Distinct short event names (after the last `::`) emitted by `module` of
    /// `package`, newest first — the on-chain coverage check (Pass Criteria 2).
    pub fn query_event_types(&self, package: &str, module: &str, limit: u64) -> Result<Vec<String>> {
        let r = self.rpc(
            "suix_queryEvents",
            json!([
                { "MoveEventModule": { "package": package, "module": module } },
                Value::Null,
                limit,
                true
            ]),
        )?;
        let mut seen = std::collections::BTreeSet::new();
        if let Some(arr) = r.get("data").and_then(|v| v.as_array()) {
            for e in arr {
                if let Some(ty) = e.get("type").and_then(|v| v.as_str()) {
                    seen.insert(short_type(ty));
                }
            }
        }
        Ok(seen.into_iter().collect())
    }

    /// Sign a serialised (unsigned) `TransactionData` (base64, e.g. from
    /// [`crate::ptb::build_unsigned`]) with `signer` and execute it. Returns the
    /// full execution `Value` (effects + events + objectChanges); errors on a
    /// non-`success` status.
    pub fn sign_and_execute(&self, tx_bytes_b64: &str, signer: &Keypair) -> Result<Value> {
        let tx_bytes = STANDARD.decode(tx_bytes_b64).context("decoding txBytes base64")?;
        let mut intent_msg = Vec::with_capacity(INTENT_TX_DATA.len() + tx_bytes.len());
        intent_msg.extend_from_slice(&INTENT_TX_DATA);
        intent_msg.extend_from_slice(&tx_bytes);
        let signature = signer.sign_intent(&intent_msg);

        let exec = self.rpc(
            "sui_executeTransactionBlock",
            json!([
                tx_bytes_b64,
                [signature],
                { "showEffects": true, "showEvents": true, "showObjectChanges": true },
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
            return Err(anyhow!("tx status={status}: {detail}"));
        }
        Ok(exec)
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

        // 2 + 3. sign Blake2b256(intent || tx_bytes) and execute.
        self.sign_and_execute(&tx_bytes_b64, signer)
            .with_context(|| format!("{module}::{function}"))
    }
}

/// Parse a `u64` JSON-string field (R2). `None` if missing/unparseable.
fn parse_u64_field(f: &Value, k: &str) -> Option<u64> {
    f.get(k).and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok())
}

/// A `Balance<T>` field renders as a bare string number in `content.fields`
/// (verified live in SIM-M2). Returns 0 if absent.
fn parse_balance_field(f: &Value, k: &str) -> u64 {
    parse_u64_field(f, k).unwrap_or(0)
}

/// A Move `Option<T>` renders as the inner value (some) or `null`/absent
/// (none) under `showContent`. True iff present and non-null.
fn option_is_some(v: Option<&Value>) -> bool {
    matches!(v, Some(val) if !val.is_null())
}

/// Read an `Option<ID>`/`Option<address>` field as `Some(id-string)` or `None`.
fn option_id(v: Option<&Value>) -> Option<String> {
    v.and_then(|val| val.as_str()).map(|s| s.to_string())
}

/// The short name of a fully-qualified Move type (`0x..::asset::FooEvent` →
/// `FooEvent`), used for compact event logging + coverage tracking.
pub fn short_type(ty: &str) -> String {
    // Strip any generic suffix first, then take the segment after the last `::`.
    let base = ty.split('<').next().unwrap_or(ty);
    base.rsplit("::").next().unwrap_or(base).to_string()
}

/// Short names of every event a transaction emitted (from `showEvents`).
pub fn event_types(exec: &Value) -> Vec<String> {
    exec.get("events")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.get("type").and_then(|v| v.as_str()))
                .map(short_type)
                .collect()
        })
        .unwrap_or_default()
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

/// Object id of a **created** object whose `objectType` ends with `type_suffix`
/// (e.g. `"::asset::Asset"`, `"::validator::ValidatorPool"`), read from the
/// transaction's `objectChanges`. Used to recover seeded object ids.
pub fn created_object_id(exec: &Value, type_suffix: &str) -> Option<String> {
    created_object_id_matching(exec, |ty| ty.ends_with(type_suffix))
}

/// Like [`created_object_id`] but matches by substring — for generic types whose
/// `objectType` carries a type parameter (`"::accumulator::GlobalYieldAccumulator<…>"`).
pub fn created_object_id_contains(exec: &Value, needle: &str) -> Option<String> {
    created_object_id_matching(exec, |ty| ty.contains(needle))
}

fn created_object_id_matching(exec: &Value, pred: impl Fn(&str) -> bool) -> Option<String> {
    let changes = exec.get("objectChanges")?.as_array()?;
    for ch in changes {
        if ch.get("type").and_then(|v| v.as_str()) != Some("created") {
            continue;
        }
        let ty = ch.get("objectType").and_then(|v| v.as_str()).unwrap_or("");
        if pred(ty) {
            if let Some(id) = ch.get("objectId").and_then(|v| v.as_str()) {
                return Some(id.to_string());
            }
        }
    }
    None
}
