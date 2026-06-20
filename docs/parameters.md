---
title: "Parameters Reference"
part: "Reference"
order: 17
summary: "Every protocol parameter the admin can tune, what it controls, and its hard cap or floor — with live values always visible on the explorer's Governance page."
keywords: ["parameters", "config", "protocol fee", "min stake", "coverage", "challenger bond", "jury quorum", "jury threshold", "bounty", "grace window", "cooldown", "governance", "hard caps"]
---

# Parameters Reference

Gally's behavior is governed by a small set of parameters held in a single on-chain configuration
object. The admin can tune them — but only within **hard caps** the admin cannot exceed, and every
change is logged on-chain. The **live values are always shown on the explorer's
[Governance](/docs/explorer) page**; this reference explains what each one *means* and its bound, not a
frozen number (numbers change; bounds and meanings don't).

## The parameters

| Parameter | Controls | Bound |
|---|---|---|
| **Protocol fee** | The fee taken from gross revenue on every deposit, before the investor split. | Capped at **10%** — it can never be set higher. |
| **Minimum validator stake** | The USDC floor required to register a validator pool, and the minimum a vouching validator must keep. | A floor (set by admin). |
| **Vouch coverage** | The percentage of a project's funding goal a validator must lock as slashable coverage to vouch for it. | A percentage (basis points). |
| **Challenger bond** | The fixed USDC amount required to open a dispute. | A fixed amount; refunded or forfeited by verdict. |
| **Jury quorum** | The minimum number of distinct juror votes required for a verdict to count. | A count (set by admin). |
| **Jury guilty threshold** | The fraction of guilty votes needed to uphold a challenge. | Always a **super-majority** — strictly more than half, up to 100%. |
| **Jury minimum stake** | The stake a validator must hold to be eligible to vote on a jury. | A floor. |
| **Challenger bounty** | The share of slashed funds paid to a winning challenger. | Capped at **50%** of the slash. |
| **Dispute window** | How long the jury voting period lasts. | A duration. |
| **Compensation grace window** | How long wrapping is frozen after a slash/default so everyone can unwrap before funds are swept. | A duration — set generously (days, not hours). |
| **Wrap cooldown** | The minimum time between wrapping and unwrapping, as defense against supply oscillation. | A duration. |
| **Entity collateral** | The percentage of the funding goal a builder must post as their own slashable skin-in-the-game. | A percentage. |

## Why hard caps matter

The caps exist so that even a compromised admin key has a **bounded blast radius**. A stolen key
cannot set the fee to 100%, drop the jury threshold to a coin-flip, or pay a challenger the entire
slash. Combined with the fact that no admin function can touch escrow or mint deeds, this keeps the
admin role firmly in the "parameters only" lane described in [Trust & Security](/docs/security).
