---
title: "Core Concepts"
part: "Understand"
order: 2
summary: "The deed, all-or-nothing escrow, milestone tranches, validators, the lazy yield index, wrapping, disputes, default, and permissionless cranks — the vocabulary everything else builds on."
keywords: ["gallyshare", "deed", "escrow", "tranche", "validator", "vouch", "yield index", "lazy index", "wrap", "unwrap", "diamond hand", "dispute", "slashing", "default", "compensation", "crank"]
---

# Core Concepts

Every other page builds on these nine ideas. Each one is summarized here; the math lives in
[The Economic Model](/docs/economics) and the safety reasoning in [Trust & Security](/docs/security).

## The digital deed (`GallyShare`)

When a raise succeeds, your contribution becomes a **deed** — an owned object on Sui called a
`GallyShare`. It is not a row in a contract's ledger; it lives in *your* wallet, and you can transfer,
sell, or use it elsewhere. **One share equals one USDC** of the original principal, so a project's
funding goal *is* its total deed supply. Each deed carries its own unclaimed-yield bookkeeping, which
means that when you transfer a deed, exactly its pending yield travels with it — no orphaned rewards,
no separate accounting.

## All-or-nothing escrow

A raise is **all-or-nothing**. While funding is open, your USDC sits in an on-chain escrow and you
hold a soulbound *receipt*. Two things can happen:

- **The goal is met** before the deadline → the raise finalizes and your receipt converts into a deed.
- **The deadline passes short of goal** → the raise fails and **everyone refunds their full
  principal**. Capital is never stranded.

Because the goal is exact, contributing more than what's left simply takes what's needed and returns
the rest in the same transaction.

## Milestone-escrowed release (tranches)

A funded project's money is **not** handed to the builder up front. It stays in escrow and is released
in **tranches** — sequential, deadline-bound slices. Each tranche unlocks only after the builder
submits proof of a real-world milestone and a **validator approves it**. Approval and withdrawal are
separate steps, on purpose: the approval is visible on-chain *before* any money moves, leaving a public
window to dispute a bad approval while the capital is still safe in escrow.

## The validator network (a decentralized legal oracle)

Validators are the bridge to off-chain reality. To **vouch** for a project, a validator locks a slice
of USDC stake — called **coverage** — against that specific project, and cryptographically signs the
content hashes of its legal documents (deeds, permits, invoices) stored on Walrus. That locked stake
*is* their bond: it says "these documents are authentic and bind this entity to this schedule." Lying
or approving a fraud gets the stake slashed to compensate investors.

## Yield by lazy index

When an operational project earns money, the revenue is split and the investors' cut is folded into a
single **global index** — the contract never loops over holders. Holders later **pull** what they're
owed. For an investor portion $P$ and current unwrapped supply $u$, the index moves by:

$$\Delta\text{index} = \frac{P \times \text{SCALE}}{u}, \qquad \text{SCALE} = 10^{9}$$

Each deed remembers the index value at its last claim, so what you're owed is just the difference
since then. This makes distribution **O(1)** whether there are ten holders or ten thousand. The full
treatment is in [The Economic Model](/docs/economics).

## Wrapping & the Diamond-Hand multiplier

A deed can be **wrapped** into a plain `Coin<T>` — a standard, fully fungible Sui coin you can trade on
a DEX or use as collateral — and **unwrapped** back into a deed. The trade-off is deliberate:

> **Only unwrapped deeds earn yield.**

The index denominator $u$ counts unwrapped supply only. So as more holders wrap (chasing liquidity),
the remaining unwrapped holders each earn a *bigger* slice. This "Diamond-Hand multiplier" is not a
setting anyone tunes — it falls straight out of the division. Wrapping and unwrapping can never create
retroactive yield for the time a deed spent wrapped; that is guaranteed by construction (see
[Economics](/docs/economics) and [Security](/docs/security)).

## Disputes, slashing & compensation

Gally stays trustless by letting **anyone** contest a validator. A challenger posts a fixed bond and
submits counter-evidence; the targeted validator's pool is frozen instantly, and a **jury** of other
validators votes. If the challenge is upheld, the validator's coverage is slashed: the challenger gets
a bounty and their bond back, and the remainder flows into a **compensation pool** for investors. If
it's rejected, the bond is forfeited (half to the jurors, half to the wrongly-accused validator).

## Default & the three-layer compensation stack

If a builder misses a tranche deadline, **anyone** can flag the default. Investors are then made whole
from three layers, in order: **undeployed escrow → the validator's slashed coverage → the entity's own
collateral**. Those funds become a compensation pool that is distributed to every holder.

## Permissionless maintenance ("cranks")

Many of the protocol's housekeeping actions — finalizing a met raise, aborting a failed one, sweeping
parked revenue, sweeping compensation, flagging a default, resolving a dispute, closing a finished
project — are **permissionless**: anyone can call them once their on-chain preconditions hold. This is
why no privileged operator can ever strand your capital: one honest actor and an expired deadline are
always enough. These are the "cranks" you'll see on the [Keeper guide](/docs/guides/keeper) and the
explorer's Cranks page.
