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

## The Smart Trust (the legal layer)

Every asset is bound by a **[Smart Trust](/docs/smart-trust)** — a legally binding, court-enforceable
contract that ties the operating entity and the real asset to your deeds. It defines ownership and
voting rights, the entity's obligations, how the asset is run and maintained, how tax is handled, and
the local/state/federal compliance that gives deed-holders legal standing. The on-chain numbers (goal,
tranche schedule, revenue split) are the **digital twin** of this contract — not figures an operator
invented. This is the off-chain half of Gally's dual-layer (code + courts) security.

## The validator network (a decentralized legal oracle)

Validators are the bridge to off-chain reality. To **vouch** for a project, a validator locks a slice
of USDC stake — called **coverage** — against that specific project, and cryptographically signs the
content hashes of the **Smart Trust** documents (deeds, permits, invoices) stored on Walrus. That
locked stake *is* their bond: it attests the documents are authentic, legally sufficient, and bind this
entity — and that the validator will keep them compliant as laws change. A false vouch, an approved
fraud, or letting the legal documents go stale gets the stake slashed to compensate investors. **You
trust the entity because the validator is bonded to the Smart Trust — not because you trust the entity
directly.**

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
retroactive yield for the time a deed spent wrapped; that is guaranteed by construction. The
dedicated [Wrapping, Liquidity & Collateral](/docs/wrapping) page covers the mechanism, the use cases
(DEX trading, lending collateral), and why the coin is trustworthy collateral; the math is in
[Economics](/docs/economics).

## Disputes, slashing & compensation

Anyone can contest a validator's attestation — and that includes the **legal strength of the Smart
Trust** itself, not just missed deadlines or faked milestones. If the physical contract fails to
deliver, or local laws change and the validator never updated the documents, that is disputable. A
challenger posts a fixed bond and counter-evidence; the targeted validator's pool freezes instantly,
and a **jury** of other validators votes. If upheld, the validator's coverage is slashed — the
challenger gets a bounty and their bond back, and the remainder flows into a **compensation pool** for
investors. If rejected, the bond is forfeited (half to the jurors, half to the wrongly-accused
validator). On-chain this slashes the validator; off-chain, the Smart Trust also gives holders standing
to pursue the entity.

## Default & the three-layer compensation stack

If a builder misses a tranche deadline, **anyone** can flag the default — and the builder is in breach
of both the on-chain protocol and the legal Smart Trust. Investors are made whole from up to three
layers, in order: **undeployed escrow → the validator's slashed coverage** (when the vouch is
successfully disputed) **→ the entity's own collateral**. Those funds become a compensation pool
distributed to every holder.

## Permissionless maintenance ("cranks")

Many of the protocol's housekeeping actions — finalizing a met raise, aborting a failed one, sweeping
parked revenue, sweeping compensation, flagging a default, resolving a dispute, closing a finished
project — are **permissionless**: anyone can call them once their on-chain preconditions hold. This is
why no privileged operator can ever strand your capital: one honest actor and an expired deadline are
always enough. These are the "cranks" you'll see on the [Keeper guide](/docs/guides/keeper) and the
explorer's Cranks page.
