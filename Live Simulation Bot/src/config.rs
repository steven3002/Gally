//! Configuration (`protocol_flow.md §5.1`): env vars overlaid on an optional
//! `config.toml`-style file (simple `KEY = "value"` lines). Connection defaults
//! always resolve; operator/ID values are required only for live re-seed and are
//! validated with a clear, fail-fast message via [`Config::operator`].

use anyhow::{bail, Context, Result};
use std::collections::BTreeMap;
use std::fs;

use crate::cli::Cli;
use crate::keys::{self, Keypair};
use crate::pace::Pace;

pub const DEFAULT_RPC_URL: &str = "http://127.0.0.1:9000";
pub const DEFAULT_FAUCET_URL: &str = "http://127.0.0.1:9123/gas";
pub const DEFAULT_RESEED_AMOUNT: u64 = 500_000_000_000; // 500,000 USDC
pub const DEFAULT_USER_COUNT: usize = 8;
pub const DEFAULT_GAS_THRESHOLD_MIST: u64 = 1_000_000_000; // 1 SUI
pub const DEFAULT_USER_KEYS_PATH: &str = "./sim_users.json";

#[derive(Debug, Clone)]
pub struct Config {
    pub rpc_url: String,
    pub faucet_url: String,
    pub pace: Pace,
    pub tick_interval_ms: u64,
    pub reseed_amount: u64,
    pub user_count: usize,
    pub user_keys_path: String,
    pub gas_threshold_mist: u64,
    // Operational — required only for live re-seed (validated by `operator`).
    pub operator_key: Option<String>,
    pub gally_package_id: Option<String>,
    pub faucet_package_id: Option<String>,
    pub mock_faucet_id: Option<String>,
    pub usdc_treasury_cap_id: Option<String>,
}

/// Validated operator context needed to mint + refill.
pub struct Operational {
    pub keypair: Keypair,
    pub address: String,
    pub gally_package_id: String,
    pub faucet_package_id: String,
    pub usdc_treasury_cap_id: String,
}

impl Config {
    /// Load from the optional config file (path via `SIM_CONFIG`, default
    /// `config.toml`) then overlay process env vars (env wins). CLI `--pace` /
    /// `--tick-ms` win over both.
    pub fn load(cli: &Cli) -> Result<Config> {
        let mut map = BTreeMap::new();
        let cfg_path = std::env::var("SIM_CONFIG").unwrap_or_else(|_| "config.toml".to_string());
        if let Ok(text) = fs::read_to_string(&cfg_path) {
            parse_kv_into(&text, &mut map);
        }
        for (k, v) in std::env::vars() {
            map.insert(k, v);
        }
        Self::from_map(&map, cli.pace, cli.tick_override)
    }

    /// Pure constructor over a key/value map — the unit-test seam.
    pub fn from_map(
        map: &BTreeMap<String, String>,
        cli_pace: Option<Pace>,
        cli_tick: Option<u64>,
    ) -> Result<Config> {
        let get = |k: &str| {
            map.get(k)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let num = |k: &str, raw: &str| -> Result<u64> {
            raw.replace('_', "")
                .parse::<u64>()
                .with_context(|| format!("{k} '{raw}' is not a non-negative integer"))
        };

        let pace = match cli_pace {
            Some(p) => p,
            None => match get("PACE") {
                Some(s) => Pace::parse(&s)?,
                None => Pace::default(),
            },
        };
        let tick_interval_ms = match cli_tick {
            Some(t) => t,
            None => match get("TICK_INTERVAL_MS") {
                Some(s) => num("TICK_INTERVAL_MS", &s)?,
                None => pace.profile().default_tick_ms,
            },
        };
        let reseed_amount = match get("RESEED_AMOUNT") {
            Some(s) => num("RESEED_AMOUNT", &s)?,
            None => DEFAULT_RESEED_AMOUNT,
        };
        let user_count = match get("USER_COUNT") {
            Some(s) => num("USER_COUNT", &s)? as usize,
            None => DEFAULT_USER_COUNT,
        };
        let gas_threshold_mist = match get("GAS_THRESHOLD_MIST") {
            Some(s) => num("GAS_THRESHOLD_MIST", &s)?,
            None => DEFAULT_GAS_THRESHOLD_MIST,
        };

        Ok(Config {
            rpc_url: get("RPC_URL").unwrap_or_else(|| DEFAULT_RPC_URL.to_string()),
            faucet_url: get("FAUCET_URL").unwrap_or_else(|| DEFAULT_FAUCET_URL.to_string()),
            pace,
            tick_interval_ms,
            reseed_amount,
            user_count,
            user_keys_path: get("USER_KEYS_PATH")
                .unwrap_or_else(|| DEFAULT_USER_KEYS_PATH.to_string()),
            gas_threshold_mist,
            operator_key: get("OPERATOR_KEY"),
            gally_package_id: get("GALLY_PACKAGE_ID"),
            faucet_package_id: get("FAUCET_PACKAGE_ID"),
            mock_faucet_id: get("MOCK_FAUCET_ID"),
            usdc_treasury_cap_id: get("USDC_TREASURY_CAP_ID"),
        })
    }

    /// Operator address (if a parseable `OPERATOR_KEY` is set), for gas funding.
    pub fn operator_address(&self) -> Option<String> {
        let k = self.operator_key.as_ref()?;
        keys::operator_from_b64(k).ok().map(|kp| kp.address)
    }

    /// Validate + assemble the operator context, failing fast with a clear list of
    /// any missing required keys.
    pub fn operator(&self) -> Result<Operational> {
        let mut missing = Vec::new();
        if self.operator_key.is_none() {
            missing.push("OPERATOR_KEY");
        }
        if self.gally_package_id.is_none() {
            missing.push("GALLY_PACKAGE_ID");
        }
        if self.faucet_package_id.is_none() {
            missing.push("FAUCET_PACKAGE_ID");
        }
        if self.usdc_treasury_cap_id.is_none() {
            missing.push("USDC_TREASURY_CAP_ID");
        }
        if !missing.is_empty() {
            bail!(
                "missing required config for operator actions: {}",
                missing.join(", ")
            );
        }
        let keypair = keys::operator_from_b64(self.operator_key.as_ref().unwrap())
            .context("parsing OPERATOR_KEY")?;
        let address = keypair.address.clone();
        Ok(Operational {
            keypair,
            address,
            gally_package_id: self.gally_package_id.clone().unwrap(),
            faucet_package_id: self.faucet_package_id.clone().unwrap(),
            usdc_treasury_cap_id: self.usdc_treasury_cap_id.clone().unwrap(),
        })
    }
}

/// Parse simple `KEY = "value"` / `KEY=value` lines (a tiny TOML subset — keeps the
/// build free of a full TOML parser). Lines starting with `#` are comments.
fn parse_kv_into(text: &str, map: &mut BTreeMap<String, String>) {
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('[') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim().to_string();
            let mut val = v.trim().to_string();
            let quoted = |val: &str, q: char| {
                val.len() >= 2 && val.starts_with(q) && val.ends_with(q)
            };
            if quoted(&val, '"') || quoted(&val, '\'') {
                val = val[1..val.len() - 1].to_string();
            }
            map.insert(key, val);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_parse_defaults() {
        let map = BTreeMap::new();
        let cfg = Config::from_map(&map, None, None).unwrap();

        assert_eq!(cfg.rpc_url, DEFAULT_RPC_URL);
        assert_eq!(cfg.faucet_url, DEFAULT_FAUCET_URL);
        assert_eq!(cfg.pace, Pace::RealWorld);
        assert_eq!(cfg.tick_interval_ms, Pace::RealWorld.profile().default_tick_ms);
        assert_eq!(cfg.reseed_amount, DEFAULT_RESEED_AMOUNT);
        assert_eq!(cfg.user_count, DEFAULT_USER_COUNT);

        // missing required operator config errors clearly
        let err = match cfg.operator() {
            Ok(_) => panic!("operator() should fail when required keys are absent"),
            Err(e) => e.to_string(),
        };
        assert!(err.contains("OPERATOR_KEY"), "expected clear missing-key error, got: {err}");
    }

    #[test]
    fn test_overrides_and_pace_tick() {
        let mut map = BTreeMap::new();
        map.insert("RPC_URL".into(), "http://node:9000".into());
        map.insert("RESEED_AMOUNT".into(), "1_000_000".into());
        // accelerated profile -> fast default tick when no explicit override
        let cfg = Config::from_map(&map, Some(Pace::Accelerated), None).unwrap();
        assert_eq!(cfg.rpc_url, "http://node:9000");
        assert_eq!(cfg.reseed_amount, 1_000_000);
        assert_eq!(cfg.tick_interval_ms, Pace::Accelerated.profile().default_tick_ms);
        // explicit tick override wins over the profile default
        let cfg = Config::from_map(&map, Some(Pace::Accelerated), Some(123)).unwrap();
        assert_eq!(cfg.tick_interval_ms, 123);
    }

    #[test]
    fn test_kv_file_parse() {
        let mut map = BTreeMap::new();
        parse_kv_into(
            "# comment\n[section]\nRPC_URL = \"http://x:9000\"\nUSER_COUNT = 3\n",
            &mut map,
        );
        assert_eq!(map.get("RPC_URL").unwrap(), "http://x:9000");
        assert_eq!(map.get("USER_COUNT").unwrap(), "3");
    }
}
