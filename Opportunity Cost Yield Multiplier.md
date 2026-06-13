
## How Shares & Yield Work in Wrapped vs Unwrapped State

The protocol has a deliberate **two-tier system** where wrapping status directly controls yield eligibility. This is the core economic mechanism, not a side effect.

### The Two States of a Position

| | **Unwrapped (`GallyShare`)** | **Wrapped (`Coin<T>`)** |
|---|---|---|
| Object type | `GallyShare` (owned, `key + store`) | Standard `sui::coin::Coin<T>` |
| Yield eligible? | **Yes** — included in the index denominator | **No** — excluded from denominator |
| Composable (DEX, lending)? | Limited (custom object) | **Full** — vanilla Coin, instant Cetus/Suilend listing |
| Tradeoff | Earns yield, less liquid | Fully liquid, forfeits yield |

### How the Math Works

The key formula from [§15.2](file:///c:/Gally/capital-protocol/milestone/gally%20core/protocol_flow.md#L718-L730):

$$\Delta\text{index} = \frac{\text{investor\_portion} \times \text{SCALE}}{\text{unwrapped}(\text{acc})}$$

where $\text{unwrapped} = \text{total\_minted\_shares} - \text{total\_wrapped\_shares}$

**The denominator only counts unwrapped shares.** This means:
- When more people wrap → fewer unwrapped shares → each remaining unwrapped share gets a **bigger** yield slice
- The spec calls this the **"Diamond Hand Multiplier"** — it's emergent, not a parameter. Holders who stay unwrapped automatically earn amplified APY funded by the forfeited yield of wrapped holders

### The Wrap / Unwrap Lifecycle

**Wrapping** (`GallyShare` → `Coin<T>`):
1. **Force-claim** all pending yield first (any unclaimed rewards are settled)
2. Destroy the `GallyShare` object
3. `total_wrapped_shares += count`
4. Mint `Coin<T>` of the same count via the custodied `TreasuryCap`

**Unwrapping** (`Coin<T>` → `GallyShare`):
1. Sweep any `rollover_reserve` (stranded revenue from periods when 100% was wrapped)
2. Burn the `Coin<T>`; `total_wrapped_shares -= amount`
3. Mint a new `GallyShare` with **`yield_claimed_index = current global index`**

That step 3 is the **critical security property**: the new share's personal index snapshot equals the global index at unwrap time, so:

$$\text{claimable} = (\text{global\_index} - \text{global\_index}) \times \text{count} = 0$$

**Zero retroactive yield for time spent wrapped** — by construction, regardless of timing, flash loans, or sandwiching.

### Edge Cases the Spec Handles

| Scenario | What Happens |
|---|---|
| **100% of shares wrapped** (nobody to receive yield) | Revenue goes into `rollover_reserve`; automatically swept into the index the moment anyone unwraps |
| **Compensation from slashing**  | `wrapping_frozen = true` during a grace window → everyone must unwrap first → then slashed funds sweep through the index → everyone gets their share. Wrapped holders can't be excluded from *compensation* (unlike regular yield) |
| **Wrap sandwich** (unwrap before big deposit, claim, re-wrap) | Economically legitimate (they *were* exposed), but damped by `min_wrap_duration_ms` cooldown |
| **Solvency** | `reward_pool ≥ Σ unclaimed entitlements` always holds (invariant I-M2). Truncation dust favors the pool |

### TL;DR

> **Unwrapped = earns yield, less liquid. Wrapped = fully liquid, no yield.** The yield formula naturally amplifies returns for unwrapped holders. This is an intentional tradeoff that incentivizes long-term holding while allowing DeFi composability for those who choose liquidity. Compensation from disputes/defaults is the one exception — the protocol freezes wrapping and gives a grace window so *everyone* can unwrap and receive their share.
