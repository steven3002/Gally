---
title: "Validators, Entities & Admin"
part: "Use"
order: 10
summary: "The roles you'll see on-chain but don't drive from the investor dApp: what validators, entities, and the admin each do, what backs their honesty, and how the explorer surfaces them."
keywords: ["validator", "entity", "builder", "admin", "roles", "vouch", "approve milestone", "stake", "tranche", "collateral", "governance", "register validator"]
---

# Validators, Entities & Admin

The investor dApp lets *users* — investors, holders, and challengers — transact. The three roles below
operate the supply side of the protocol. You will see them all over the explorer, and understanding
them makes the whole system legible, even though you drive them through their own tooling rather than
the investor app.

## Validators — the decentralized legal oracle

Validators are the bridge between on-chain capital and off-chain reality. They stake USDC and put it
on the line to attest that projects are legitimate.

- **Register & stake.** A validator creates a pool by depositing at least the minimum USDC stake.
  Anyone can top a pool up; only the validator can withdraw, and only *free* stake — never locked
  coverage, and never while frozen or slashed.
- **Vouch.** To bring a project to funding, a validator locks **coverage** (a configured percentage of
  the funding goal) against it and signs the content hashes of its legal documents. That locked stake
  is their bond on the documents' authenticity.
- **Approve milestones.** As the builder submits proof for each tranche, the vouching validator reviews
  it and approves — publicly, and before any money moves.
- **Vote on disputes.** Validators serve as the jury when another validator is challenged.
- **The risk.** If a vouch or approval is shown to be fraudulent, the validator's coverage is **slashed**
  to compensate investors, and their pool is permanently retired.

The explorer's **Validators** section shows each pool's stake, locked coverage, status, and full track
record — vouches, approvals, and any disputes — so anyone can judge a validator before trusting their
projects.

## Entities — the builders and businesses

An entity is the real-world party raising capital: a developer, a manufacturer, a trading business.

- **List a project.** The entity defines the funding goal (which equals the deed supply), a **tranche
  schedule** (each slice with its own deadline and description), the **revenue split** owed to
  investors, and posts its own **collateral**. The goal must equal the sum of the tranches — every
  dollar raised is assigned to a milestone.
- **Hit milestones.** For each tranche, the entity uploads real-world proof (photos, permits, invoices)
  to Walrus and submits its reference, then withdraws the tranche **after** a validator approves it.
- **Deposit revenue.** Once operational, revenue (rent, sales, usage fees) is deposited and split
  automatically — the entity can't withhold the investors' cut.
- **The risk.** Miss a tranche deadline and **anyone** can flag a default: the entity's collateral and
  the undeployed escrow are seized to compensate investors.

An entity is **never trusted** on-chain — every privilege is gated behind validator approval or a
programmatic precondition.

## Admin — parameters only

The admin is the protocol deployer, holding a soulbound `AdminCap`. Its power is deliberately narrow:

- **Tune parameters** — fees, stake floors, dispute settings, the treasury address — each within a
  **hard cap** the admin cannot exceed (for example, the protocol fee can never be set above 10%, and
  the jury guilty-threshold can never drop to a simple majority).
- **Trigger the emergency pause** — which halts new capital *entry* but, by design, **never** blocks
  exits.
- **Reclaim terminal dust** — only the tiny rounding residue of a fully closed project.

What the admin **cannot** do is the important part: it cannot touch escrow, mint deeds, move user
funds, or override a dispute. Every parameter change is logged on-chain and visible on the
[Governance](/docs/explorer) page. See the [Parameters Reference](/docs/parameters) for the full list
and their bounds.
