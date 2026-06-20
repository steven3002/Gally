---
title: "Glossary"
part: "Reference"
order: 16
summary: "Every Gally term in one place, alphabetically: from accumulator and coverage to rollover, soulbound, tranche, vouch, and wrapping."
keywords: ["glossary", "definitions", "terms", "accumulator", "coverage", "deed", "index", "rollover", "soulbound", "tranche", "vouch", "wrap", "compensation", "crank"]
---

# Glossary

**Accumulator** — the shared object paired with each operational project that holds the yield index,
the reward pool, and the project's mint authority. It is the engine that turns deposited revenue into
claimable yield.

**All-or-nothing** — the funding rule: a raise either reaches its goal and converts to deeds, or fails
and refunds everyone in full. Capital is never partially deployed.

**Compensation pool** — funds gathered to make investors whole after a slashing or a default
(undeployed escrow, slashed coverage, and entity collateral). Distributed through the yield index after
a grace window.

**Coverage** — the slice of a validator's stake locked against one specific project they've vouched
for. It is their slashable bond on that project's legitimacy.

**Crank** — a permissionless maintenance action anyone can call once its on-chain conditions hold
(finalize, abort, sweep, flag-default, resolve, close). See the [Keeper guide](/docs/guides/keeper).

**Deed** — the everyday name for a `GallyShare`: an owned, transferable Sui object representing
fractional ownership, where one share equals one USDC of original principal.

**Diamond-Hand multiplier** — the emergent effect by which unwrapped holders earn a larger yield share
as others wrap, because the index counts only unwrapped supply.

**Entity** — the real-world party (builder, business, manufacturer) raising capital for a project.

**Grace window** — the period after a slashing or default during which wrapping is frozen so every
holder can unwrap and become eligible for compensation before it is swept.

**Index** (cumulative yield index) — a single running number representing lifetime investor revenue per
unwrapped share. Holders compute what they're owed from the gap between it and their last claim.

**Lazy pull** — the O(1) distribution model: deposits move the index; holders pull their own delta on
claim. No loops over holders, ever.

**One-time witness (OTW)** — the Sui pattern a project's token package uses to guarantee a single,
unique token type with a virgin mint authority.

**Receipt** (`ContributionReceipt`) — the soulbound object you hold during funding; burn it to refund
(if the raise fails) or to claim your deed (if it succeeds).

**Reward pool** — the USDC inside an accumulator that backs all unclaimed yield. It always holds at
least what is owed.

**Rollover reserve** — revenue parked when unwrapped supply is zero; swept into the index on the first
unwrap so nothing is stranded.

**SCALE** — the fixed-point scaling constant ($10^{9}$) used so the index can track fractional
per-share yield in integer math.

**Slashing** — the seizure of a validator's coverage (or an entity's collateral) to compensate
investors after proven misbehavior.

**Soulbound** — a Sui object that cannot be transferred by generic code (it lacks the `store`
ability). The capability keys and the contribution receipt are soulbound.

**Tranche** — one deadline-bound, validator-gated slice of a project's escrowed capital, released only
after its milestone is proven and approved.

**Validator** — a staked party who vouches for projects' legal documents and approves their milestones,
and who serves on dispute juries. Backed by slashable USDC.

**Vouch** — a validator's stake-backed attestation that a project's legal documents are authentic,
which moves the project into funding.

**Wrapping / unwrapping** — converting a deed into a standard `Coin<T>` for DeFi liquidity (wrap) and
back into a yield-earning deed (unwrap). Wrapped coins forfeit yield; unwrapping owes zero retroactive
yield for the wrapped period.
