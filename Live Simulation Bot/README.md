# Gally Root Simulator — Operator Runbook (`gally_sim_bot`)

The **Root Simulator** brings the whole Gally stack *alive*: it publishes the protocol to a fresh
local Sui chain, then continuously drives **real `gally_core` transactions** (contributions, vouches,
tranche releases, revenue, yield claims, wraps, disputes, cranks…) so the Backend Indexer fills up
and the Frontend Explorer renders **live, continuously-updating** data.

> **The chain is the only IPC.** The bot runs *no* web server. Everything it does is an on-chain
> transaction; everything you observe comes from the indexer reading that chain.

This runbook gets you from a clean checkout to a live, self-updating explorer two ways:

- **[A. One command](#a-one-command-run_stacksh)** — `./run_stack.sh` does the entire bring-up.
- **[B. Manual bring-up](#b-manual-bring-up)** — the same steps by hand, for when you want control.

---

## What you get

```
                          ssh tunnel (9000 RPC, 9123 gas-faucet)
   remote Sui node  ───────────────────────────────────────────►  localhost:9000 / :9123
   (low local RAM:                                                      │
    node runs on 'trace')                                               ▼
                                            ┌──────────────── publish gally_core + faucet + N token templates
                                            │                          │  (captures the post-publish IDs)
                                            ▼                          ▼
   Frontend Explorer  ◄──  Backend Indexer  ◄──  Postgres   ◄──  Root Simulator bot
   (live mode)              (REST + WS)          (gally-pg)     (--seed-all genesis, then --daemon traffic)
```

The bot owns two long-running behaviours (the **Dual-State Engine**):

| `--pace` | tick cadence | time regime | use it for |
|---|---|---|---|
| `real-world` *(default)* | 30 s | protocol time params are immutable law; parallel cohorts keep *some* event flowing | believable public demo / long soak |
| `accelerated` | 2 s | AdminCap-warps dispute/grace/vouch/min-wrap windows to ~5 s (the `Clock` itself is **never** stepped) | fast end-to-end / CI / "see everything in minutes" |

---

## Prerequisites

- **Local:** `sui` CLI (matching the node, 1.73), `cargo`, `docker`, `ssh`, `curl`, `python3`. A Sui
  keystore with **one** address — that single entry is the **operator** (publishes the packages and
  signs operator-only txns). Check with `sui client active-address`.
- **Remote node host** reachable over an SSH alias (default `trace`) with `sui` on its `PATH`. The
  node runs there because the full node + indexer + DB together exceed local RAM.
- **Postgres** for the indexer: a container named `gally-pg`
  (`docker run -d --name gally-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`).

> **Sim USDC is local-only.** This stack publishes the **locally-mintable Mock USDC profile** of the
> `usdc` package. It is *never* the production Circle-USDC type and must never be published to a
> shared network.

---

## A. One command (`run_stack.sh`)

From the repo root:

```bash
./run_stack.sh --soak 40            # full bring-up + a bounded 40-tick activity soak
./run_stack.sh                      # bring-up + genesis only (then drive traffic yourself)
SSH_ALIAS=trace ./run_stack.sh --soak 200 --pace accelerated
```

It performs, in order:

0. **Preflight** — verify tools, confirm `ssh <alias>` reachable with `sui`, clear any stale local
   indexer / bot / tunnel processes.
1. **Remote node + tunnel** — `pkill -x sui` on the host, wipe the stale `/tmp/.tmp*` RocksDB dirs
   (the host's `/tmp` is a small tmpfs; old regenesis DBs otherwise fill it), launch
   `sui start --with-faucet --force-regenesis`, open `ssh -L 9000 -L 9123`, and **poll
   `127.0.0.1:9000` until JSON-RPC answers** with a chain id.
2. **Fund + deploy** — faucet the operator until it holds a coin ≥ the gas budget, then publish
   `gally_core` → `gally_mock_faucet` → **N entity-token templates** (the entity-token pool) to the fresh
   chain, parsing every post-publish ID. Handles the Sui 1.73 env-aware publish
   (`[environments] localnet = "<chain-id>"` + a reset `Published.toml`) automatically.
3. **`config.toml`** — written for you with the operator key + all captured IDs; `sim_state.json`
   records the entity-token pool.
4. **Postgres + indexer** — start `gally-pg`, create the `gally_live` DB, build and launch the
   the indexer (background) at `127.0.0.1:8088`.
5. **Bot** — `--seed-all` genesis (an asset in **every** lifecycle state, K=3 validators, a positive
   yield index, a funded faucet), then — if `--soak N` — a bounded `--daemon` activity run.

**Flags & env overrides**

| Flag | Default | Meaning |
|---|---|---|
| `--soak N` | `0` (genesis only) | after genesis, run the daemon for N ticks then stop |
| `--pace P` | `accelerated` | `real-world` \| `accelerated` for the soak |
| `--pool N` | `6` | entity-token templates to publish (≥ #OPERATIONAL assets) |
| `--no-node` | — | reuse an already-running node + tunnel (skip phase 1) |

| Env | Default | |
|---|---|---|
| `SSH_ALIAS` | `trace` | ssh host running the node |
| `RPC_PORT` / `FAUCET_PORT` | `9000` / `9123` | tunneled ports |
| `GAS_BUDGET` | `3000000000` | per-publish budget; operator must hold one coin ≥ this |
| `ENTITY_POOL_SIZE` | `6` | same as `--pool` |
| `PG_CONTAINER` / `INDEXER_DB` / `INDEXER_BIND` | `gally-pg` / `gally_live` / `127.0.0.1:8088` | |

When it finishes it prints the chain id, package id, indexer URL, and the two commands to **continue
traffic** or **tear down**.

### Continue / tear down

```bash
# keep generating traffic indefinitely (real-world cadence, the long-soak profile):
cd "$REPO" && SIM_CONFIG="$REPO/config.toml" "Live Simulation Bot/target/debug/gally_sim_bot" --daemon

# tear everything down:
pkill -f gally_indexer
pkill -f -- "-L 9000:127.0.0.1:9000"     # the ssh tunnel
ssh trace 'pkill -x sui'                  # the remote node
```

### Devnet bring-up (`run_devnet.sh`)

`./run_devnet.sh` is the same bring-up against **official Sui Devnet** instead of a throwaway local
node. Two things change because there is no controllable node and gas is scarce:

- **Operator-funded gas (`GAS_SOURCE=operator`).** There is no per-run faucet for the cohort, so the
  bot funds its fake users out of the operator wallet (`unsafe_paySui`) instead of a SUI faucet.
- **Dynamic gas throttling.** Before genesis the bot reads the operator's **live balance** and
  computes how many users it can afford, **overriding `USER_COUNT` down** to fit (with a warning) so a
  thin grant can never out-of-gas mid-run — pure logic in `gas.rs` (`plan_gas` / `affordable_users`).
  It publishes `usdc` + `gally_core` + `gally_mock_faucet` + templates to devnet while **preserving**
  the committed mainnet→Circle USDC mapping, points the indexer at the devnet RPC, then seeds + soaks.

The daemon is resumable: it reads `sim_state.json` and **continues from the existing chain** (no
re-publish / re-seed) — so a restart after a devnet hiccup picks up where it left off.

---

## B. Manual bring-up

```bash
# 1. node (on the remote host, over ssh)
ssh trace 'pkill -x sui; rm -rf /tmp/.tmp*; nohup sui start --with-faucet --force-regenesis >sui.log 2>&1 &'
ssh -L 9000:127.0.0.1:9000 -L 9123:127.0.0.1:9123 -N trace &      # tunnel; wait until 127.0.0.1:9000 answers

# 2. publish + capture IDs (gally_core, then gally_mock_faucet)
sui client faucet                                                  # fund the operator
cd gally_core          && sui client publish --json --gas-budget 3000000000  # → GALLY_PACKAGE_ID, PROTOCOL_CONFIG_ID, ADMIN_CAP_ID, USDC_TREASURY_CAP_ID
cd ../gally_mock_faucet && sui client publish --json --gas-budget 3000000000 # → FAUCET_PACKAGE_ID, MOCK_FAUCET_ID
#    (also publish ≥6 entity-token templates via entity_token_template/scripts/instantiate.sh
#     and record them in sim_state.json — run_stack.sh automates this fiddly step)

# 3. config.toml  (copy the template, paste the IDs)
cp "Live Simulation Bot/config.toml.example" config.toml && $EDITOR config.toml

# 4. indexer (Backend Indexer track), pointed at GALLY_PACKAGE_ID
cd "Backend Indexer" && DATABASE_URL=postgres://postgres:postgres@localhost:5432/gally_live \
  SUI_NODE_URL=http://127.0.0.1:9000 GALLY_PACKAGE_ID=0x… API_BIND=127.0.0.1:8088 cargo run &

# 5. bot — genesis, then continuous traffic
cd "Live Simulation Bot"
SIM_CONFIG=../config.toml cargo run -- --seed-all          # genesis: every lifecycle state
SIM_CONFIG=../config.toml cargo run -- --daemon            # continuous real-world traffic
#   or:  cargo run -- --daemon --pace accelerated          # speed-run everything

# 6. frontend in live mode, pointed at the indexer → open the explorer and watch it update
```

---

## Bot CLI reference

```
gally_sim_bot [--pace real-world|accelerated] [--tick-ms N] [--check] [--once] [--fund] [--seed-all] [--daemon] [--cycles N]
```

| Flag | Effect |
|---|---|
| `--seed-all` | **Genesis:** AdminCap time-warp, K validators, an asset in *every* lifecycle state, the entity-token pool, a funded faucet. Idempotent (re-run = no-op via `sim_state.json`). |
| `--fund` | One claim+contribute funding pass over the user cohort, then exit. |
| `--daemon` | **Activity generator:** per tick, re-seed the faucet if low + one weighted-random protocol action covering every protocol event family. Runs forever unless `--cycles`. |
| `--cycles N` | Bound the daemon (or re-seed loop) to N ticks, then exit — CI-style soak. |
| `--pace P` | `real-world` (30 s ticks, organic) \| `accelerated` (2 s ticks, warped windows, enables disputes). Overrides `PACE`. |
| `--tick-ms N` | Override the profile's default cadence. |
| `--once` | One re-seed tick (no activity), then exit. |
| `--check` | Connect, read the faucet, exit (smoke test). |

---

## `config.toml` template & ID table

The shipped template is **`config.toml.example`** (every key below; validated by
`test_config_template_complete`). `run_stack.sh` writes a filled `config.toml` for you; for a manual
bring-up, copy the template and paste the post-publish IDs. `config.toml` + `sim_users.json` are
**gitignored** — they hold the operator key / throwaway sim seeds.

```toml
# connection
RPC_URL    = "http://127.0.0.1:9000"      # tunneled remote node JSON-RPC
FAUCET_URL = "http://127.0.0.1:9123/gas"  # SUI gas faucet (from --with-faucet)
# pacing / traffic  (CLI --pace / --tick-ms override these)
PACE              = "real-world"          # real-world | accelerated
TICK_INTERVAL_MS  = "30000"               # ms between daemon ticks
RESEED_AMOUNT     = "500000000000"        # μUSDC minted into the faucet per re-seed (500k USDC)
USER_COUNT        = "12"                   # fake-user cohort size (holder distribution)
GAS_THRESHOLD_MIST= "1000000000"          # top an address up from the SUI faucet below this
# local paths
USER_KEYS_PATH = "./sim_users.json"       # persisted cohort keypairs (stable across restarts)
SIM_STATE_PATH = "./sim_state.json"       # seeded-object id cache (idempotency; entity-token pool)
# operator + post-publish IDs (REQUIRED)
OPERATOR_KEY         = "PASTE"   # base64(flag||privkey): the single entry in ~/.sui/sui_config/sui.keystore
GALLY_PACKAGE_ID     = "0xPASTE"
PROTOCOL_CONFIG_ID   = "0xPASTE"
ADMIN_CAP_ID         = "0xPASTE"
USDC_TREASURY_CAP_ID = "0xPASTE"
FAUCET_PACKAGE_ID    = "0xPASTE"
MOCK_FAUCET_ID       = "0xPASTE"
```

Env vars override `config.toml` (env wins). Point `SIM_CONFIG` at the file, or keep it as
`config.toml` in the working directory. (To derive `OPERATOR_KEY` from a `suiprivkey…` string:
`sui keytool convert <suiprivkey>` → use the `base64WithFlag` value.)

**What each ID is**

| Key | What it is | Where it comes from |
|---|---|---|
| `OPERATOR_KEY` | the publisher / operator private key (`flag‖privkey`, base64) | the one entry in `~/.sui/sui_config/sui.keystore` |
| `GALLY_PACKAGE_ID` | the published `gally_core` package | `gally_core` publish output |
| `PROTOCOL_CONFIG_ID` | the shared `ProtocolConfig` (all tunable params + pause) | created by `gally_core::init` |
| `ADMIN_CAP_ID` | the `AdminCap` (time-warp, param setters, wind-down) — operator-owned | created by `gally_core::init` |
| `USDC_TREASURY_CAP_ID` | `TreasuryCap<USDC>` for the **sim** Mock-USDC (local-only) | `usdc` publish output |
| `FAUCET_PACKAGE_ID` | the published `gally_mock_faucet` package | faucet publish output |
| `MOCK_FAUCET_ID` | the shared `MockFaucet` (the USDC reservoir the bot re-seeds) | created by the faucet's `init` |

> The bot reads `PROTOCOL_CONFIG_ID` for the config object, manages the faucet via the operator key
> directly (no separate operator-cap key in v1), and takes the pool size from `run_stack.sh --pool` /
> `ENTITY_POOL_SIZE` at publish time (recorded in `sim_state.json`). Without the REQUIRED IDs the bot
> runs **read-only** (connect + read faucet + fund user gas).

---

## Hardening (what makes an unattended soak safe)

- **Graceful shutdown (Ctrl-C).** `SIGINT` sets an atomic flag; the daemon finishes the current tick,
  **flushes `sim_state.json`**, and exits — no orphaned tasks, no half-written cache. Interruptible
  sleeps mean Ctrl-C is honoured within ~200 ms even between ticks.
- **A failed tx never kills the loop.** Every tick's result is absorbed: a Move abort, RPC error, or
  missing-object is logged as `action failed — skipping (loop continues)` and the daemon proceeds to
  the next tick. Soaks routinely log expected aborts (e.g. claiming with nothing owed) and keep going.
- **Tunable traffic.** Cadence via `--tick-ms` / `TICK_INTERVAL_MS` / `--pace`; action mix via the
  weighted catalog in `src/action.rs`.
- **Throttled, structured logging.** `RUST_LOG=info` (per-action one-liners with the events emitted)
  or `RUST_LOG=warn` (only re-seeds, skips, errors) for long soaks. The daemon also tracks on-chain
  **event-family coverage** as it goes — stdout counters, **never an HTTP endpoint**.

---

## Known limits

- **Real-time `Clock`.** The on-chain `0x6` `Clock` is never fast-forwarded (impossible on a live
  node). `accelerated` only *shrinks the deadlines the clock is compared against* (via AdminCap
  setters + short per-asset deadlines), so short **real** waits suffice; it does not step time.
- **OPERATIONAL asset count is bounded by the entity-token pool.** Each successful raise
  consumes one pre-published `entity_token_template` copy (one virgin `TreasuryCap<T>` per finalize).
  Publish at least as many templates as the OPERATIONAL assets you want (`--pool`, default 6).
- **Validators are operated by the operator key in v1.** All validator pools are registered
  and run by the single operator address; the sim does not model independent third-party validators.
- **Sim USDC is local-only.** The locally-mintable Mock USDC profile is a stand-in for Circle USDC —
  distinct from, and never to be confused with, the production-USDC swap.
- **`accelerated` inflates APY.** Warped windows compress yield accrual into seconds, so
  backend-derived APY reads high under accelerated time; `real-world` is faithful.

---

## Acceptance walkthrough ("the explorer comes alive")

With the stack up (`./run_stack.sh --soak …` then `--daemon`), open the explorer (live mode)
and confirm, over a few minutes of traffic:

- [ ] **Assets** lists demo assets in multiple lifecycle states; states change during the soak.
- [ ] An **asset detail** page shows contributions, tranche releases, revenue, and yield accruing.
- [ ] **Holders / Portfolio** show real per-address positions.
- [ ] **Validators** shows registered pools; (accelerated) at least one **dispute** appears & resolves.
- [ ] **Governance** reflects a parameter change / pause+resume.
- [ ] The **faucet reservoir** visibly refills after claims.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `node did not become reachable …within ~120s` | node still booting, or the tunnel didn't open. Check `ssh trace 'tail sui.log'`; ensure ports 9000/9123 are free locally. |
| `Cannot find gas coin … sufficient for the required gas budget` | operator unfunded. `run_stack.sh` faucets until a coin ≥ `GAS_BUDGET` lands; manually: `sui client faucet` and re-check `sui client gas`. |
| `bind [127.0.0.1]:9000: Address already in use` | a previous tunnel survives. `pkill -f -- "-L 9000:127.0.0.1:9000"`, then retry. |
| remote node won't start / `/tmp` full | the host's `/tmp` is a small tmpfs; stale `--force-regenesis` RocksDB dirs fill it. `ssh trace 'rm -rf /tmp/.tmp*'` (the script does this each run). |
| `could not start container gally-pg` | create it once (see Prerequisites), then re-run. |
| publish: `already published` / address mismatch | stale `Published.toml`. The script resets it + rewrites `[environments] localnet = "<chain-id>"` each run; manually, clear `Published.toml` and set the chain id. |

---

## Developer reference

**Transport.** Synchronous `ureq` JSON-RPC + lightweight crypto (`ed25519-dalek`,
`blake2`, `base64`) — **not** `tokio`+`reqwest`, **not** `sui-sdk`. A lazy sequential tick loop
(read → maybe act → sleep) gains nothing from async, and the lean TLS-free tree keeps the build cheap
on a low-RAM box. Txns are built by the node (`unsafe_moveCall`) or as a serialized PTB, then signed
locally: `signature = base64(flag ‖ ed25519_sign(Blake2b256(intent ‖ tx_bytes)) ‖ pubkey)`, submitted
via `sui_executeTransactionBlock`.

**Module map**

| File | Role |
|---|---|
| `cli.rs` | flag parser (`--pace`, `--tick-ms`, `--check`, `--once`, `--fund`, `--seed-all`, `--daemon`, `--cycles`; hand-rolled, no clap) |
| `pace.rs` | Dual-State Engine: `Pace::{RealWorld,Accelerated}` parse + profile (cadence/traffic/time-regime) |
| `config.rs` | env over a `config.toml`-style file; defaults; fail-fast operator validation |
| `keys.rs` | ed25519 fake-user keys (persisted → stable addresses); Sui address; operator-key parse; signing |
| `sui_client.rs` | JSON-RPC: chain id, object fields, `MockFaucet`/`Asset` read, SUI balance, sign+submit, `objectChanges` parsing |
| `ptb.rs` | build multi-command PTBs via `sui client ptb … --serialize-unsigned-transaction` |
| `gas.rs` | lazy SUI gas-faucet top-up |
| `reseed.rs` | `should_reseed` + mint(`TreasuryCap<USDC>`)→`refill` executor |
| `seed.rs` / `activity.rs` | funding-slice genesis + the user claim+contribute loop |
| `lifecycle.rs` | full genesis: every lifecycle state + K validators + entity-token pool |
| `action.rs` | weighted action catalog + pure precondition selectors |
| `daemon.rs` | tick loop: reseed + one weighted action; error containment; graceful shutdown; coverage tracker |
| `catalog.rs` / `walrus.rs` | trustless-metadata catalog + mock-Walrus |
| `rng.rs` | dependency-free PRNG |
| `sim_state.rs` | `sim_state.json` cache of seeded object ids (re-derivable; never a source of truth) |
| `main.rs` | BOOT → connect → keys → ENSURE_GAS → install Ctrl-C handler → dispatch `--fund`/`--seed-all`/`--daemon`/re-seed loop |

**Build & test**

```bash
cargo build                 # 0 warnings
cargo test                  # unit tests (no node needed), incl. hardening tests
```

> Build-env note: on a low-RAM box the crates.io endpoints may need an IPv4 `/etc/hosts` pin and
> `cargo` `jobs = 2` — see the `sim-local-publish-gotchas` memory.
