---
title: "FAQ"
part: "Reference"
order: 16
summary: "Plain-language answers to the questions newcomers actually ask: is my money safe, what if the raise fails or the builder runs, why wrapped coins don't earn, what the admin can do, and how this differs from a normal token."
keywords: ["faq", "is my money safe", "raise fails", "builder runs", "wrapped no yield", "admin power", "everyone wraps", "validators", "audit", "mainnet", "erc-20", "difference"]
---

# Frequently Asked Questions

## Is my money safe?

Every place your capital sits at risk has a **permissionless exit that can never be paused** — refund,
claim, unwrap, or redeem. Beyond that, the people who *could* misbehave are bonded: builders post
collateral, validators stake slashable coverage, and the admin can never touch funds at all. The one
risk that remains is real-world execution (a building might genuinely not get built) — but even then,
misbehavior is slashable and you are compensated. See [Trust & Security](/docs/security).

## What happens if a raise doesn't reach its goal?

It fails, and **everyone gets a full refund.** Raises are all-or-nothing: if the deadline passes short
of the goal, the project moves to a failed state and every contributor can burn their receipt to
withdraw their exact principal. This exit is never pausable.

## What if the builder takes the money and runs?

They can't take it up front. Funded money stays in escrow and is released only **tranche by tranche**,
each gated by a validator-approved real-world proof. If the builder misses a tranche deadline, anyone
can flag a **default**: the undeployed escrow and the builder's own collateral are seized to compensate
investors. See [Scenario 6](/docs/scenarios).

## Why don't my wrapped coins earn yield?

Wrapping trades yield for liquidity, on purpose. A wrapped coin is a standard, fully tradable token you
can use anywhere in DeFi — but the yield index only counts *unwrapped* deeds. The upside: when others
wrap, the holders who stay unwrapped earn a **bigger** share (the Diamond-Hand effect). Unwrap whenever
you want yield again — with zero penalty for the time spent wrapped. See [Economics](/docs/economics).

## Can the admin freeze or take my funds?

No. The admin can tune parameters (within hard caps) and trigger an emergency pause — but the pause is
**one-sided**: it halts new deposits while leaving every exit open. No admin function can spend escrow,
mint deeds, or move your balances. A stolen admin key cannot drain the protocol.

## What if everyone wraps their deeds at once?

Revenue that arrives while nobody is unwrapped is parked in a **rollover reserve** rather than lost. The
moment anyone unwraps, the reserve is swept into the index and distributed — and the first unwrapper
shares in it. No revenue is stranded by the 100%-wrapped case.

## The "amplified" yield sounds too good — what's the catch?

There's no free money. The amplification is just the yield that *wrapped* holders give up being divided
among *unwrapped* holders. If you're the one earning more, it's because others chose liquidity over
yield. If everyone unwraps, yield is shared evenly. It's a redistribution, not an invention.

## Who are the validators, and what stops them lying?

Validators are independent parties who stake USDC to vouch that a project's legal documents are real,
signing the documents' content hashes. If they vouch for a fraud, **anyone** can challenge them, a jury
of other validators votes, and a guilty validator's stake is **slashed** to compensate investors. Their
honesty is backed by money they lose if they lie. See [Validators](/docs/roles).

## Is Gally audited? Is it on mainnet?

The contracts are feature-complete with extensive automated test suites and currently run on **Sui
Devnet** (a free test network). A production-grade document layer and a mainnet publish — with real
Circle USDC — remain ahead. Today is the place to try everything risk-free.

## How is this different from a normal tokenized asset (an ERC-20)?

On many chains, "owning" a tokenized asset means holding a balance recorded in a shared contract ledger
— you don't truly hold a thing. On Sui, your `GallyShare` deed is an **owned object in your own wallet**:
it carries its own yield bookkeeping, moves its pending yield with it when transferred, and is natively
composable with other protocols. Gally pairs that with milestone-escrowed funding and slashable
attestation, which a plain token standard does not provide.
