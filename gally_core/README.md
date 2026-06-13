# gally_core

Sui Move package implementing the Gally protocol: trustless RWA capitalization,
milestone-escrowed funding, validator-staked legal attestation, lazy-index yield
distribution, and a 1:1 share↔coin wrap machine.

**Authoritative specification:** `../milestone/gally core/protocol_flow.md`.
Code conforms to the spec; amend the spec before deviating in code.
Milestone status: root `CLAUDE.md`.

## Build & test

```sh
sui move build
sui move test
```

## Module map

| Module | Responsibility |
|---|---|
| `protocol` | `ProtocolConfig` singleton, `AdminCap`, parameter governance, asymmetric pause |
| `validator` | Per-validator stake pools, coverage locking, freeze/slash primitives |
| `asset` | Project state machine: vouching, all-or-nothing raise, tranche escrow, default |
| `share` | `GallyShare` deed: package-only mint/burn, split |
| `accumulator` | Yield index math, claims, rollover, wrap/unwrap machine, `TreasuryCap<T>` custody |
| `usdc` | ⚠️ Placeholder for canonical Circle USDC — replace before any non-test publication |

## The `entity_token_template` handshake

Each funded asset gets its own fungible wrapper type `Coin<T>`. The type is NOT
declared in this package — it comes from a one-shot package the entity publishes
from `../entity_token_template/`:

1. The entity publishes the template with a fresh one-time witness type `T`
   (e.g., `HORIZON_TOWER`). The template's `init` creates the
   `TreasuryCap<T>` and `CoinMetadata<T>` and transfers the cap to the entity.
   **The template must mint nothing.**
2. At `asset::finalize_successful_raise<T>`, the entity's `TreasuryCap<T>` is
   handed over and the accumulator asserts `total_supply == 0`
   (`ECapNotVirgin`) — a pre-minted cap is rejected outright, because supply
   parity (`Coin<T>` supply == wrapped shares, invariant I-W1) must hold from
   the first instant.
3. The cap is custodied inside `GlobalYieldAccumulator<T>` **forever**. No
   function returns it; the only mint path is `wrap_shares`, the only burn
   path is `unwrap_coins`. Nobody — entity, admin, or validator — can inflate
   the wrapper supply.

`Coin<T>` itself is a vanilla `sui::coin` with zero custom logic, which is what
makes it instantly listable on DEXs and usable as DeFi collateral. Yield
eligibility lives entirely on the unwrapped `GallyShare` side (spec §11–§12).

## Capacity limit (stated)

Index math is u128 with a 1e9 fixed-point scale. Payouts assert `≤ u64::MAX`
(`EPayoutOverflow`). Lifetime investor revenue per share-unit beyond ~2^34 raw
USDC units exceeds the design envelope (spec §15.1) — astronomically above any
realistic asset.
