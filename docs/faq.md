---
title: "FAQ"
part: "Reference"
order: 17
summary: "Plain-language answers: is my money safe (the dual-layer model), what a Smart Trust is, what happens if a raise fails or a builder runs, why wrapped coins don't earn, what the admin can do, and how this differs from a normal token."
keywords: ["faq", "is my money safe", "smart trust", "dual layer", "raise fails", "builder runs", "wrapped no yield", "admin power", "court", "validators", "audit", "mainnet", "erc-20", "difference"]
---

# Frequently Asked Questions

## Is my money safe?

Your capital is protected by a **dual-layer** security model: **on-chain escrow** and the **off-chain
Smart Trust.** On-chain, your funds are mathematically protected — every place your capital sits at risk
has a permissionless exit that can never be paused (refund, claim, unwrap, redeem). Off-chain, the asset
is bound by a **[Smart Trust](/docs/smart-trust)** — a legally enforceable contract dictating terms,
voting rights, maintenance, tax, and jurisdictional compliance. You don't blindly trust the operator;
you trust the entity *because a validator staked their own capital to vouch for that Smart Trust's legal
strength*, and they're slashed if reality stops matching the documents. The remaining risk is real-world
execution and the limits of local courts — see [Trust & Security → Honest Limitations](/docs/security).

## What is a "Smart Trust"?

It's the legally binding, court-enforceable contract behind every Gally asset — the bridge from tokens to
physical reality. It defines what your deed entitles you to, how the asset is operated and maintained,
how tax is handled, and the local/state/federal compliance that gives holders legal standing. The
on-chain numbers (goal, tranches, revenue split) are a faithful *digital twin* of it. Full detail on
the [Smart Trust page](/docs/smart-trust).

## What happens if a raise doesn't reach its goal?

It fails, and **everyone gets a full refund.** Raises are strictly all-or-nothing: if the deadline passes
short of the goal, the project moves to a failed state and every contributor can burn their receipt to
withdraw their exact principal. This exit is hardcoded and can never be paused.

## What if the builder takes the money and runs?

They can't take it up front, and they're legally bound to the asset. Funded money stays in escrow and is
released only **tranche by tranche**, each gated by a validator-approved real-world proof. If the builder
misses a tranche deadline, anyone can flag a **default**: the undeployed escrow and the builder's own
collateral are seized to compensate investors (and, if the vouch is successfully disputed, the
validator's coverage too). Off-chain, missing milestones also breaches the Smart Trust — so investors
have standing to pursue the entity in court. See [Scenario 6](/docs/scenarios).

## Why don't my wrapped coins earn yield?

Wrapping trades yield for liquidity, on purpose. A wrapped `Coin<T>` is a standard, fully tradable token
you can use anywhere in DeFi — but the yield index only counts *unwrapped* deeds. The upside: when others
wrap, holders who stay unwrapped earn a **bigger** share (the Diamond-Hand effect). Unwrap whenever you
want yield again — with zero penalty for the time spent wrapped. See [Wrapping](/docs/wrapping).

## Can the admin freeze or take my funds?

No. The admin can tune parameters (within hard caps) and trigger an emergency pause — but the pause is
**one-sided**: it halts new deposits while leaving every exit open. No admin function can spend escrow,
mint deeds, or move your balances. A stolen admin key cannot drain the protocol.

## What if everyone wraps their deeds at once?

Revenue that arrives while nobody is unwrapped is parked in a **rollover reserve** rather than lost. The
moment anyone unwraps, the reserve is swept into the index and distributed — and the first unwrapper
shares in it. No revenue is stranded by the 100%-wrapped case.

## Who are the validators, and what stops them lying?

Validators are independent parties who stake USDC to vouch for an asset's Smart Trust — its legal
strength *and* its ongoing compliance — and to approve milestones. If they vouch for a fraud, approve a
fake milestone, or let the documents fall out of date as laws change, **anyone** can challenge them, a
jury of other validators votes, and a guilty validator's stake is **slashed** to compensate investors.
Their honesty is backed by money they lose if they're wrong. See [Validators](/docs/roles).

## Do I really have legal standing — can I take an entity to court?

That's the point of the Smart Trust: it legally names the entity and binds it to the deeds, so holders
have a basis to pursue remedies in a real court. Gally provides the mathematical infrastructure (escrow,
slashing, compensation); **local courts provide the legal enforcement.** The strength of that standing
ultimately depends on the asset's jurisdiction — which is exactly why validators are bonded to keep the
Smart Trust sound.

## Is Gally audited? Is it on mainnet?

The contracts are feature-complete with extensive automated test suites and currently run on **Sui
Devnet** (a free test network). A production-grade document layer and a mainnet publish — with real
Circle USDC — remain ahead. Today is the place to try everything risk-free.

## How is this different from a normal tokenized asset (an ERC-20)?

Two ways. First, ownership: on many chains "owning" a tokenized asset means holding a balance in a shared
contract ledger — you don't truly hold a thing. On Sui, your `GallyShare` deed is an **owned object in
your own wallet** that carries its own yield bookkeeping and is natively composable. Second, and bigger:
Gally pairs the token with a **Smart Trust** — a real legal wrapper — plus milestone-escrowed funding and
slashable attestation. The token isn't just a number; it's a cryptographically secure receipt for a
legally defensible claim.
