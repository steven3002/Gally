---
title: "The Economic Model"
part: "Understand"
order: 4
summary: "How the money math works: goal-equals-supply pricing, the three-way revenue split, the lazy yield index and claim formula, the Diamond-Hand multiplier, rollover, compensation, solvency, and the no-retroactive-yield theorem."
keywords: ["economics", "yield", "index", "claim formula", "revenue split", "diamond hand", "apy", "rollover", "compensation", "solvency", "wrap math", "scale", "fixed point"]
---

# The Economic Model

This is the rigorous version of how Gally moves money. All of the math below is fixed-point integer
arithmetic — there are no floats on-chain — using a scaling constant $\text{SCALE} = 10^{9}$, computed
in 128-bit integers, **multiplying before dividing**, and always **flooring in the protocol's favor**.

## Pricing: the goal *is* the supply

Gally never needs a price oracle. A project's funding goal, measured in USDC, is also its **exact total
deed supply**:

$$\text{total shares} = \text{funding goal}, \qquad 1\ \text{share} = 1\ \text{USDC of principal}$$

Because pricing is fixed at one-to-one, there is nothing to quote, manipulate, or feed from outside.
This single decision removes an entire class of oracle risk.

## The three-way revenue split

When revenue arrives at an operational project, the contract splits **every** deposit atomically — the
entity is never trusted to "send the investors' share." For gross revenue $G$, a protocol fee rate
$f$, and an investor split $s$ (both in basis points):

$$
\text{fee} = \frac{G \times f}{10000}, \qquad
\text{investor} = \frac{(G - \text{fee}) \times s}{10000}, \qquad
\text{entity} = G - \text{fee} - \text{investor}
$$

The fee goes to the protocol treasury, the investor portion enters the yield index, and the remainder
returns to the entity — in one transaction.

## The lazy yield index

Rather than pushing payments to every holder (which would cost gas proportional to the number of
holders), Gally moves a single **global index** and lets holders pull. When an investor portion $P$ is
deposited and the current unwrapped supply is $u$:

$$\Delta\text{index} = \frac{P \times \text{SCALE}}{u}, \qquad \text{index} \mathrel{+}= \Delta\text{index}$$

Every deed stores the index value at its last claim (its *personal index*). What a holder is owed is
the gap between the global index and their personal index, times their share count:

$$\text{payout} = \frac{(\text{global index} - \text{personal index}) \times \text{share count}}{\text{SCALE}}$$

On claim, the deed's personal index is set equal to the global index, so the same yield can never be
claimed twice. Both operations are **O(1)** — independent of how many holders exist.

## The Diamond-Hand multiplier

The denominator $u$ above is **unwrapped supply only**. Wrapped coins are excluded. So as holders wrap
their deeds for liquidity, $u$ shrinks and each remaining unwrapped deed earns a larger share of every
deposit:

$$\text{yield per unwrapped deed} \;\propto\; \frac{1}{u} \;\uparrow \quad \text{as wrapped supply} \uparrow$$

In the extreme, if everyone but you wraps, you receive essentially the entire investor portion of each
deposit. This amplification is **emergent** — there is no multiplier parameter to set or game. It is
simply the reward for staying unwrapped, funded by the yield that wrapped holders forfeit. For what the
wrapped coin is *for* — DEX trading, lending collateral, and why it's a trustworthy claim — see
[Wrapping, Liquidity & Collateral](/docs/wrapping).

## Rollover: revenue while nobody is unwrapped

If revenue arrives when unwrapped supply is **zero** (everyone has wrapped), dividing by $u$ is
undefined. Instead the investor portion parks in a **rollover reserve**. The moment anyone unwraps, the
reserve is swept into the index and distributed — and the first unwrapper, now counted in $u$, shares
in it. No revenue is ever lost to the 100%-wrapped case.

## Compensation distribution

Slashed and seized funds (from disputes or defaults) are distributed through the **same index machinery**
as ordinary revenue, after a grace window. Because the index only reaches *unwrapped* holders, the
protocol first **freezes wrapping** and opens a grace window so everyone can unwrap, then sweeps the
compensation pool through the index. The scaling factor is mandatory here too — without it, a
restitution smaller than the unwrapped supply would floor to zero and strand.

## Solvency: the pool always covers what it owes

Define what the protocol owes as the sum, over all unwrapped deeds, of each deed's claimable payout.
The core solvency invariant is:

$$\text{reward pool} \;\geq\; \sum_{\text{unwrapped deeds}} \text{owed}$$

The argument is short: every deposit adds $P$ to the reward pool but increases total owed by
$\Delta\text{index} \times u / \text{SCALE} \le P$ (because $\Delta\text{index}$ floors). Every claim
decreases both by the same payout. Wrapping force-claims first (zeroing that deed's term); unwrapping
adds a term worth exactly zero. So the pool is always at least what is owed, and the tiny gap is
exactly the accumulated rounding **dust** — which stays in the pool as a safety buffer and is only
reclaimable once the project has fully closed.

## No retroactive yield for wrapped time

When you unwrap, the new deed's personal index is set to the **current** global index. So for any
wrap-then-unwrap round trip between times $t_1$ and $t_2$:

$$\text{claimable over } [t_1, t_2] = \big(\text{index}(t_2) - \text{index}(t_2)\big) \times \text{count} = 0$$

**You earn exactly zero yield for the time your deed spent wrapped — by construction.** This holds
regardless of transaction ordering, block boundaries, or flash-loan tricks. A short cooldown between
wrapping and unwrapping is layered on top as extra defense against oscillating supply around a known
large deposit, but the zero-retroactive-yield guarantee does not depend on it.

## A stated capacity limit

All index and payout math is done in 128-bit integers with an explicit overflow check on each payout,
so amounts can never silently wrap around. There is one honestly-disclosed bound: an asset whose
*lifetime revenue per share* grows astronomically large could in theory exceed the safe arithmetic
range. For any realistic project this is never approached, and it is documented as a capacity limit
rather than hidden.
