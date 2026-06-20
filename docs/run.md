---
title: "Run & Build"
part: "Build & Operate"
order: 14
summary: "Bring the whole stack up with one command, build and test each component, and understand the four environments (mock, local, devnet, mainnet) and how USDC resolves in each."
keywords: ["run", "build", "test", "run_stack.sh", "run_devnet.sh", "devnet", "localnet", "mainnet", "environments", "usdc resolution", "quickstart", "operator", "developer"]
---

# Run & Build

This page is for anyone who wants to run Gally themselves — to evaluate it, demo it, or build on it.
The repository is a monorepo; each component has its own README with deeper detail.

## One-command bring-up

The fastest path is the end-to-end orchestration scripts at the repo root. Each one publishes the
contracts, starts the indexer, seeds demo data, and runs the activity bot so the explorer fills with
live, continuously-updating data.

| Target | Command |
|---|---|
| **Local Sui node** | `./run_stack.sh --soak 40` |
| **Official Sui Devnet** | `./run_devnet.sh` |

`run_stack.sh` spins up a fresh local network for a fully self-contained run. `run_devnet.sh` publishes
to the public Sui Devnet and writes the live object IDs back to its config so the indexer and explorer
point at the right deployment.

## Per-component build & test

Each component builds and tests on its own:

| Component | Commands |
|---|---|
| Move packages (`gally_core`, `gally_mock_faucet`, `usdc`) | `sui move build && sui move test` |
| Backend Indexer (Rust) | `cargo build && cargo test` |
| Live Simulation Bot (Rust) | `cargo build && cargo test` |
| Frontend Explorer (Next.js) | `pnpm typecheck && pnpm lint && pnpm build && pnpm test` |

## The four environments

Gally is designed to run identically across networks; only the money and the faucet change.

| Environment | USDC | Faucet | Use |
|---|---|---|---|
| **Mock** (frontend offline) | fixture data | n/a | UI development and tests, no chain required. |
| **Local** | mintable mock | yes | Full self-contained stack on a local node. |
| **Devnet** | mintable mock | yes | The live public demo (today's deployment). |
| **Mainnet** | **real Circle USDC** | **none** | Production. |

The settlement coin resolves at the **same module path** in every environment, so the protocol's code
never changes — only which package that path points at. On mainnet it resolves to Circle's published,
verified USDC; everywhere else to a locally-mintable mock. This is why "USDC is mintable" is strictly a
test-network convenience.

## The live Devnet deployment

Gally is currently published on **Sui Devnet**. The current package and shared-object IDs are listed in
the repository's root README, which is the single source of truth for them.

> Sui Devnet is wiped periodically (≈ weekly). After a reset those IDs go stale — re-running
> `./run_devnet.sh` republishes everything and writes the fresh IDs back to its config.
