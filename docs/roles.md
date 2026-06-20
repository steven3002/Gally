---
title: "Validators, Entities & Admin"
part: "Use"
order: 12
summary: "The supply side that originates and secures real assets: validators (the decentralized legal oracle that vouches the Smart Trust), entities (operators legally bound by it), and the parameter-only admin — the roles that make the dual-layer (code + courts) model legible."
keywords: ["validator", "entity", "builder", "admin", "roles", "smart trust", "legal oracle", "vouch", "compliance", "approve milestone", "stake", "tranche", "collateral", "governance", "digital twin"]
---

# Validators, Entities & Admin

The investor dApp is for capital allocation and yield. The physical assets are originated and secured by
the **supply side**: validators, entities, and the admin. Understanding these three makes Gally's
dual-layer security model — **code + courts** — completely legible. You'll see all of them across the
explorer, even though you drive them through their own tooling rather than the investor app.

## Validators — the decentralized legal oracle

Validators are the bridge between on-chain capital and off-chain reality. They don't merely check that a
PDF is authentic; they stake their own USDC to attest to the **legal enforceability and compliance** of
an asset's [Smart Trust](/docs/smart-trust).

- **Register & stake.** A validator initializes a pool by depositing at least the minimum USDC stake.
  Anyone can top a pool up, but only the validator can withdraw free stake — and never while locked,
  frozen, or slashed.
- **Vouch the Smart Trust.** To bring a project to funding, a validator locks **coverage** (a percentage
  of the funding goal) against it. By doing so they legally and financially vouch that the asset is bound
  by a robust Smart Trust — a contract dictating voting rights, maintenance, tax, and local/federal
  compliance — and that they will keep it sound as conditions change.
- **Approve milestones.** As the builder submits real-world proof for each tranche, the vouching
  validator reviews and approves it publicly, before any escrowed capital moves.
- **The risk & liability.** Validators are financially liable for damages. If a vouch is fraudulent, if
  they approve a fake milestone, or if they fail to update the legal structure when local laws change,
  their coverage is slashed (via a jury dispute) to compensate investors.
- **Track record.** The explorer surfaces every validator's locked coverage, vouches, approvals, and
  dispute history, so the market can price their reliability.

## Entities — the operators bound by the Smart Trust

An entity is the real-world operator raising capital: a real-estate developer, a manufacturer, a trade
financier.

- **Digitizing the legal reality.** An entity does not invent numbers on-chain. They propose a funding
  goal, a tranche schedule, and a revenue split that strictly mirror the legally binding terms in their
  Smart Trust. The on-chain asset is the **digital twin** of that contract.
- **Hit milestones.** For each tranche, the entity uploads real-world proof (photos, permits, invoices)
  to Walrus and can withdraw the allocated capital only after a validator verifies the proof against the
  Smart Trust.
- **Deposit revenue.** Once operational, the entity deposits revenue (rent, sales, usage fees), which the
  lazy-index engine distributes to deed holders automatically — the entity can't withhold the investors'
  cut.
- **The risk & accountability — dual-layer.** On-chain, missing a tranche deadline triggers a default
  that seizes their undeployed escrow and collateral. Off-chain, they remain legally bound by the Smart
  Trust, giving investors real standing to pursue damages in court if the contract is breached.

So an entity *is* trusted to operate — but never with unconditional custody of funds, and never on
goodwill alone. That trust is held in place by code, by the validator's stake, and by the courts.

## Admin — parameters only

The admin is the protocol deployer, holding a soulbound `AdminCap`. Its power is deliberately narrow and
strictly mathematical:

- **Tune parameters.** Adjust fees, stake floors, dispute settings, and the treasury address — each
  bound by hardcoded limits the admin cannot exceed (e.g., the protocol fee can never exceed its
  ceiling, and the jury guilty-threshold can never drop to a simple majority).
- **Emergency pause.** Halts new capital entry during a crisis. By design, the pause can **never** block
  exits (refunds, claims, unwraps, redemptions).
- **What the admin cannot do.** Touch escrow, mint deeds, move user funds, or override a decentralized
  dispute. The admin is trusted only with system parameters — never with your money. Every change is
  immutably logged and visible on the [Governance](/docs/explorer) page; the bounds are in the
  [Parameters Reference](/docs/parameters).
