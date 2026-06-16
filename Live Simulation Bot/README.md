# Gally Root Simulator bot (`gally_sim_bot`)

The Rust "lazy worker" of the Live Simulation track. SIM-M2 scope: connect to a
local Sui node, keep the on-chain **`MockFaucet`** topped up, and parse the
Dual-State Engine `--pace` flag. SIM-M3 (in progress) adds the **funding slice**
behind `--fund`: seed a vouched FUNDING asset and drive the simulated user cohort
to claim Mock USDC and `contribute_capital`, paced by `--pace`. The full
every-lifecycle-state genesis and the SIM-M4 activity generator are **not** here yet.

> Specs: `milestone/live-simulation/protocol_flow.md` (§5 architecture, §5.3 the
> Dual-State Engine / SIM-D8, §6 tick machine, §10 re-seed) + `guard_rails.md`.
> The bot runs **no server** (SIM-D7) — the chain is the only IPC.

## Transport choice (recorded per the SIM-M2 work order)

**Synchronous `ureq` JSON-RPC + lightweight crypto** (`ed25519-dalek`, `blake2`,
`base64`) — **not** `tokio`+`reqwest` and **not** `sui-sdk`.

- *Why sync:* a lazy sequential tick loop (read → maybe act → sleep) gains nothing
  from async, and this dev box has ~0.5 GB free RAM — the lean, TLS-free tree keeps
  the build cheap and avoids OOM. The m-file explicitly leaves transport to SIM-M2.
- Transactions are built by the node (`unsafe_moveCall`), then signed locally:
  `signature = base64(flag ‖ ed25519_sign(Blake2b256(intent ‖ tx_bytes)) ‖ pubkey)`,
  submitted via `sui_executeTransactionBlock`.

## Modules

| File | Role |
|---|---|
| `cli.rs` | `--pace`, `--tick-ms`, `--check`, `--once`, `--fund` (hand-rolled, no clap) |
| `pace.rs` | Dual-State Engine: `Pace::{RealWorld,Accelerated}` parse + profile (cadence/traffic/time-regime) |
| `config.rs` | env over a `config.toml`-style file; defaults; fail-fast operator validation; `PROTOCOL_CONFIG_ID` |
| `keys.rs` | ed25519 fake-user keys (persisted → stable addresses); Sui address; operator-key parse; signing |
| `sui_client.rs` | JSON-RPC: chain id, object fields, `MockFaucet`/`Asset` read, SUI balance, sign+submit (move call **or** serialized PTB), `objectChanges` parsing |
| `ptb.rs` | build a multi-command PTB via `sui client ptb --sender @addr --serialize-unsigned-transaction` (claim+transfer, contribute+change, mint→register/create, walrus-vec→vouch) |
| `gas.rs` | lazy SUI gas-faucet top-up |
| `reseed.rs` | `should_reseed` + mint(`TreasuryCap<USDC>`)→`refill` executor |
| `seed.rs` | SIM-M3 funding-slice genesis: operator seeds 1 validator + 1 vouched FUNDING asset (idempotent) |
| `activity.rs` | SIM-M3 funding loop: each sim user claims + `contribute_capital` in one PTB, paced by `--pace` |
| `sim_state.rs` | `sim_state.json` cache of seeded object ids (re-derivable; never a source of truth — SIM-D6/R5) |
| `main.rs` | BOOT → connect → keys → ENSURE_GAS → (`--fund`: re-seed + seed + funding loop) → re-seed tick loop |

## Configuration

Env vars or a `config.toml`-style file (path via `SIM_CONFIG`, default `config.toml`;
simple `KEY = "value"` lines; env overrides the file). See `protocol_flow.md §5.1`.
`config.toml` and `sim_users.json` are **gitignored** (they hold the operator key /
private seeds — local throwaway sim keys only).

Required for live re-seed: `OPERATOR_KEY` (sui.keystore base64 `flag‖privkey` form —
`sui keytool convert <suiprivkey>` gives `base64WithFlag`), `GALLY_PACKAGE_ID`,
`FAUCET_PACKAGE_ID`, `MOCK_FAUCET_ID`, `USDC_TREASURY_CAP_ID`. Without them the bot
runs **read-only** (connect + read faucet + fund user gas).

## Build & run

```bash
cargo build                 # 0 warnings
cargo test                  # 9/9 unit tests (no node needed)

# against a running SIM-M1 deployment, with config.toml filled with the IDs:
SIM_CONFIG=config.toml cargo run -- --check     # connect, read faucet, exit
SIM_CONFIG=config.toml cargo run -- --once      # one re-seed tick, exit
SIM_CONFIG=config.toml cargo run                # continuous re-seed loop
SIM_CONFIG=config.toml cargo run -- --pace accelerated   # faster tick cadence
```

Build env note: on this box the crates.io endpoints need an IPv4 `/etc/hosts` pin
and `cargo` `jobs = 2` (low RAM) — see the `sim-local-publish-gotchas` memory.
