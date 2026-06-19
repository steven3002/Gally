# gally_mock_faucet

The **On-Chain Faucet** for the Gally Root Simulator (Live Simulation track).
Publishes one shared **`MockFaucet`** object — a reservoir of Mock USDC that any
wallet may draw a single fixed `allocation` from. It is the only thing a
frontend wallet talks to in order to obtain test funds, and the only new
on-chain artifact the simulation introduces.

> **Spec:** `milestone/live-simulation/protocol_flow.md §2`. Read
> `milestone/live-simulation/guard_rails.md` (R1–R3) before changing anything.

## What it is (and isn't)

- The faucet **never mints**. Minting authority is the `TreasuryCap<USDC>` held
  by the Root Simulator bot/operator (SIM-D2), which periodically `refill`s the
  reservoir. The faucet only ever *splits* the reservoir on `claim`.
- **One claim per address**, enforced by O(1) `Table` membership (no loops).
- It vends **Mock USDC only** (SIM-D3). The "mock protocol entities" are real
  `gally_core` objects created elsewhere by the bot — never synthetic structs
  here.

## Surface (`gally_mock_faucet::faucet`)

| Function | Who | Effect |
|---|---|---|
| `claim(faucet, ctx): Coin<USDC>` | anyone, once | splits `allocation` from the reservoir; records the claimant; returns the coin (purity — caller's PTB routes it) |
| `refill(faucet, deposit, ctx)` | anyone (bot) | joins `deposit` into the reservoir |
| `admin_set_allocation(faucet, cap, new)` | `FaucetOperatorCap` | sets the per-claim payout |
| `admin_set_low_water_mark(faucet, cap, new)` | `FaucetOperatorCap` | sets the re-seed threshold |
| views | anyone | `reservoir_value`, `allocation`, `low_water_mark`, `total_claimed`, `claim_count`, `has_claimed(addr)` |

**Events:** `FaucetCreatedEvent`, `FaucetClaimedEvent`, `FaucetRefilledEvent`,
`FaucetParamChangedEvent` (a faucet feed, separate from the `gally_core` §18
catalog). **Errors:** `EAlreadyClaimed (0)`, `EReservoirEmpty (1)`,
`EZeroAmount (2)`. **Defaults (init):** `allocation = 25,000 USDC`,
`low_water_mark = 100,000 USDC`, reservoir `0` (bot's first re-seed fills it).

## Dependency on Mock USDC (SIM-D1)

This package depends on the standalone `usdc` package solely to name the canonical
settlement coin type `usdc::usdc::USDC` (Circle's published USDC on mainnet, the
locally-mintable mock on localnet/sim). On a live node that coin must be mintable, so
`usdc/sources/usdc.move` runs under its **SIM-D1 profile**: `init` creates the currency
(6 decimals), freezes the metadata, and hands the `TreasuryCap<USDC>` to the publisher.

> ⚠️ The SIM-D1 profile is **not** the production Circle-USDC swap. See
> `gally_core/sources/usdc.move` header and `guard_rails.md` R1.

## Build & test

```bash
cd gally_mock_faucet
sui move build      # 0 warnings
sui move test       # all green
```

## Publish (fresh local node)

```bash
sui start --with-faucet --force-regenesis            # separate terminal

cd gally_core           && sui client publish --gas-budget 500000000
cd ../gally_mock_faucet && sui client publish --gas-budget 200000000
# capture: GALLY_PACKAGE_ID, FAUCET_PACKAGE_ID, MOCK_FAUCET_ID, CONFIG_ID,
#          ADMIN_CAP_ID, USDC_TREASURY_CAP_ID, FAUCET_OPERATOR_CAP_ID,
#          frozen CoinMetadata<USDC> ID  — these feed the SIM-M2 bot config.
```

Then mint Mock USDC with the `TreasuryCap<USDC>`, `refill` the faucet, and
`claim` from a fresh address to smoke-test (see `milestone/live-simulation/m1.md`).
