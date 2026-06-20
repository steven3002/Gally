# gally_core

Sui Move package implementing the Gally protocol: trustless RWA capitalization,
milestone-escrowed funding, validator-staked legal attestation, lazy-index yield
distribution, and a 1:1 share↔coin wrap machine. This is the on-chain heart of the
system — every other component reads from or writes to the objects defined here.

Build & test: `sui move build && sui move test`.

## Module map

| Module | Responsibility |
|---|---|
| `protocol` | `ProtocolConfig` singleton, `AdminCap`, parameter governance, asymmetric pause |
| `validator` | Per-validator stake pools, coverage locking, freeze/slash primitives |
| `asset` | Project state machine: vouching, all-or-nothing raise, tranche escrow, default |
| `share` | `GallyShare` deed: package-only mint/burn, split |
| `accumulator` | Yield index math, claims, rollover, wrap/unwrap machine, `TreasuryCap<T>` custody |
| `dispute` | Challenger bonds, validator jury (one-pool-one-vote), slashing & restitution routing |

> **Settlement coin.** The protocol settles in `usdc::usdc::USDC`, supplied by the external
> [`../usdc/`](../usdc) package — **not** an in-package module. It resolves to Circle's published
> USDC under `--build-env mainnet` and to a locally-mintable Mock USDC otherwise (tests mint via
> `coin::mint_for_testing<usdc::usdc::USDC>`). See that package's README.

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
eligibility lives entirely on the unwrapped `GallyShare` side.

## Yield & wrap math (the `accumulator`)

Yield is distributed by a **lazy index**, never by looping over holders (invariant
**I-M4** — no code path iterates holders, contributors, or shares). On a revenue
deposit, the investor portion $P$ moves the global index by, for unwrapped supply
$u = \text{total\_minted} - \text{total\_wrapped}$:

$$\Delta\text{index} = \frac{P \times \text{SCALE}}{u}, \qquad \text{SCALE} = 10^{9}$$

Each deed stores a personal index snapshot; a claim pays the difference and
re-snapshots:

$$\text{payout} = \frac{(\text{index}_{\text{global}} - \text{index}_{\text{personal}}) \times \text{share\_count}}{\text{SCALE}}$$

All math is `u128`, scaled by `SCALE`, **multiply-before-divide**, flooring toward
the pool. The floored remainder stays in `reward_pool`, which is what makes the
solvency invariant an inequality in the safe direction:

$$\text{value(reward\_pool)} \;\ge\; \sum_{\text{unwrapped deeds}} \text{unclaimed entitlement} \qquad (\text{I-M2})$$

Two edge branches: when $u = 0$ (everyone wrapped) revenue accrues to
`rollover_reserve` instead of dividing by zero, and is swept into the index once
unwrapped supply returns; the denominator excluding wrapped supply is exactly the
**Diamond-Hand multiplier** — wrapped holders forfeit yield to the holders who
stayed unwrapped (see [`../Opportunity Cost Yield Multiplier.md`](../Opportunity%20Cost%20Yield%20Multiplier.md)).

## Lifecycle & closure

```
PENDING_VOUCH ─vouch─▶ FUNDING ─finalize─▶ EXECUTING ─last tranche─▶ OPERATIONAL ─close─▶ CLOSED
     │                    │                    │                                          ▲
  cancel                abort             flag_default ─▶ COMPENSATING ─sweep+close───────┘
     ▼                    ▼
 CANCELLED             FAILED
```

`CLOSED` is the terminal absorbing state. It has three triggers, each a thin
public wrapper over one private `close` helper (Move cannot express an "optional
capability" parameter, so the single `close_asset` access-control row is realised
as three functions):

- `close_at_return_target<T>` — trade-finance term complete: `acc.lifetime_investor_revenue ≥ asset.return_target`. Permissionless. Listed via `create_term_asset` (`return_target ≥ funding_goal`).
- `close_after_compensation<T>` — post-default: grace elapsed and the compensation pool emptied by `sweep_compensation`. Permissionless.
- `close_wind_down<T>` — natural end-of-life: `AdminCap` **and** the asset's `EntityCap` co-sign in one tx.

All three mirror a `closed` flag onto the accumulator and emit
`AssetClosedEvent { reason }`. On `CLOSED`, deposits and wraps abort while
`claim_rewards`, `unwrap_coins`, and `redeem_share` stay open forever.
`redeem_share` force-claims final yield, burns the deed, and decrements
`total_minted_shares`; once `total_minted == total_wrapped == 0`,
`admin_sweep_dust` reclaims the truncation residue — guarded by a running
`dust_bound` so the sweep can never take a holder's money (`EDustBoundExceeded`).

## Capacity limit (stated)

Index math is u128 with a 1e9 fixed-point scale. Payouts assert `≤ u64::MAX`
(`EPayoutOverflow`). Lifetime investor revenue per share-unit beyond ~2^34 raw
USDC units exceeds the design envelope — astronomically above any realistic
asset. Truncation dust accrues only in the safe direction (favoring
`reward_pool`, keeping I-M2 an inequality) and is reclaimable solely at closure.

## Access-control conformance checklist (hardening audit)

Every public entry was reviewed against the protocol's access-control matrix; the
capability and pause columns are each enforced by exactly the right assert.

| Function | Capability | Pause | Version | Note |
|---|---|---|---|---|
| `protocol::admin_*` | `AdminCap` | n/a | ✅ | hard-capped params (A10) |
| `validator::register_validator` | stake ≥ min | ✅ | ✅ | |
| `validator::add_stake` | — | ❌ | ❌ | top-up only raises security |
| `validator::withdraw_stake` | `ValidatorCap` | ❌ exit | ✅ | three-way floor (A3) |
| `asset::create_asset` / `create_term_asset` | collateral | ✅ | ✅ | one validated builder |
| `asset::cancel_unvouched_by_entity` | `EntityCap` | ❌ exit | ❌ | entity's own collateral |
| `asset::cancel_unvouched_timeout` | anyone post-timeout | ❌ | ✅ | |
| `asset::vouch_asset_legals` | `ValidatorCap` + stake | ✅ | ✅ | |
| `asset::contribute_capital` | payment | ✅ | ✅ | |
| `asset::finalize_successful_raise` | anyone + virgin cap | ❌ | ✅ | A7, A15 |
| `asset::abort_failed_raise` | anyone | ❌ exit | ✅ | A15 |
| `asset::refund_contribution` | own receipt | ❌ exit | ✅ | I-X1 |
| `asset::claim_shares` | own receipt | ❌ | ✅ | |
| `asset::{submit_proof,approve,release}` | `EntityCap`/`ValidatorCap` | ✅ | ✅ | approve≠release (A1,A2) |
| `asset::release_vouch_coverage` | vouching pool | ❌ exit | ❌ | reclaims locked stake |
| `asset::flag_default` | anyone | ❌ exit | ✅ | A15 |
| `asset::deposit_revenue` | anyone | ✅ | ✅ | aborts in CLOSED (state) |
| `asset::close_*` (×3) | path-dependent | ❌ | ✅ | terminal settlement |
| `accumulator::claim_rewards` | own share | ❌ exit | ❌ | pure exit, config-free |
| `accumulator::wrap_shares` | own share | ✅ | ✅ | aborts frozen **or** CLOSED |
| `accumulator::unwrap_coins` | coins | ❌ exit | ❌ | works during grace (A12) |
| `accumulator::sweep_rollover/compensation` | anyone | ❌ exit | ❌ | permissionless rescue (A11) |
| `accumulator::merge_shares` / `share::split_share` | own shares | ❌ | ❌ | hygiene; can't strand funds |
| `accumulator::redeem_share` | own share | ❌ exit | ❌ | requires CLOSED |
| `accumulator::admin_sweep_dust` | `AdminCap` | n/a | ✅ | CLOSED + zero supply + dust bound |

**Deliberate version-gate exceptions.** The accumulator's pure exits
(`claim_rewards`, `unwrap_coins`, `redeem_share`, the sweeps) and the asset's
exit-like reclaims (`cancel_unvouched_by_entity`, `release_vouch_coverage`) take
no `ProtocolConfig`, so they omit `assert_version` on purpose: these paths return
a holder's own yield, principal, or collateral and must stay callable even after
a mis-configured upgrade — the kill-switch guards capital **entry** and
governance, never capital **exit** (D6, I-X1).
