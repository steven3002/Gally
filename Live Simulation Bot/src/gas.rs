//! SUI **gas** faucet client (from `sui start --with-faucet`). Tops an address up
//! to keep it able to pay for transactions. This is the node's SUI faucet — wholly
//! distinct from the protocol's Mock-USDC `MockFaucet`.

use anyhow::{anyhow, Result};
use serde_json::json;
use tracing::info;

use crate::sui_client::SuiClient;

pub struct GasFaucet {
    url: String,
    agent: ureq::Agent,
}

impl GasFaucet {
    pub fn new(url: &str) -> Self {
        GasFaucet {
            url: url.to_string(),
            agent: ureq::agent(),
        }
    }

    /// Request a fixed gas grant for `address` from the local SUI faucet.
    pub fn request_gas(&self, address: &str) -> Result<()> {
        let body = json!({ "FixedAmountRequest": { "recipient": address } });
        self.agent
            .post(&self.url)
            .set("Content-Type", "application/json")
            .send_string(&body.to_string())
            .map_err(|e| anyhow!("SUI gas faucet request for {address} failed: {e}"))?;
        Ok(())
    }

    /// Request gas only when `address` is below `threshold_mist` (lazy top-up).
    pub fn ensure_gas(&self, client: &SuiClient, address: &str, threshold_mist: u64) -> Result<()> {
        let balance = client.sui_balance(address).unwrap_or(0);
        if balance < threshold_mist {
            info!(address, balance, threshold = threshold_mist, "gas low — requesting from SUI faucet");
            self.request_gas(address)?;
        } else {
            info!(address, balance, "gas sufficient");
        }
        Ok(())
    }
}
