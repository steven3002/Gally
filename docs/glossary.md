---
title: "Glossary"
part: "Reference"
order: 18
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

**Decentralized Legal Oracle** — the validator network's real role: parties who stake USDC to attest
to, and continuously maintain, the **legal enforceability and compliance** of an asset's Smart Trust —
not merely to confirm a document exists.

**Deed** — the everyday name for a `GallyShare`: an owned, transferable Sui object representing
fractional ownership, where one share equals one USDC of original principal.

**Diamond-Hand multiplier** — the emergent effect by which unwrapped holders earn a larger yield share
as others wrap, because the index counts only unwrapped supply.

**Digital twin** — the on-chain reflection (funding goal, tranche schedule, revenue split, closure
terms) of the off-chain Smart Trust's legally agreed terms. The numbers aren't invented on-chain — they
mirror the legal contract.

**Dual-layer security** — Gally's model: on-chain *code* (escrow, never-pausable exits, slashing, the
yield engine) for mathematical safety, plus the off-chain *Smart Trust* (a court-enforceable contract)
for legal enforcement. Code + courts.

**Entity** — the real-world party (builder, business, manufacturer) that operates the asset and raises
capital. Legally bound by the Smart Trust and computationally restricted on-chain — trusted to operate,
never trusted with unconditional custody of funds.

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

**Smart Trust** — the legally binding, court-enforceable contract that ties the operating entity and the
real asset to the deeds. It defines ownership and voting rights, the entity's obligations,
operation/maintenance, tax handling, and local/state/federal compliance — the off-chain half of Gally's
[dual-layer security](/docs/smart-trust). Its document hashes are pinned on-chain and vouched by a
validator.

**Soulbound** — a Sui object that cannot be transferred by generic code (it lacks the `store`
ability). The capability keys and the contribution receipt are soulbound.

**Tranche** — one deadline-bound, validator-gated slice of a project's escrowed capital, released only
after its milestone is proven and approved.

**Validator** — a decentralized legal oracle: a staked party who vouches for an asset's Smart Trust
(its legal strength + compliance), approves milestones, and serves on dispute juries. Liable for
damages — backed by slashable USDC.

**Vouch** — a validator's stake-backed attestation that an asset's Smart Trust is authentic, legally
sufficient, and compliant — which moves the project into funding and remains the validator's standing
liability.

**Wrapping / unwrapping** — converting a deed into a standard `Coin<T>` for DeFi liquidity (wrap) and
back into a yield-earning deed (unwrap). Wrapped coins forfeit yield; unwrapping owes zero retroactive
yield for the wrapped period.
