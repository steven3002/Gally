---
title: "Trust & Security Model"
part: "Understand"
order: 7
summary: "Gally's dual-layer security: on-chain code makes capital mathematically safe (escrow, never-pausable exits, slashing) while the off-chain Smart Trust makes the asset legally enforceable. Trust pillars, capabilities, the dispute jury, the attack/defense matrix, and honest limitations."
keywords: ["security", "trust", "is it safe", "smart trust", "dual layer", "code and courts", "slashing", "capabilities", "admincap", "pause", "jury", "dispute", "legal rot", "attacks", "sha256", "limitations", "jurisdiction", "audit"]
---

# Trust & Security Model

Gally's central thesis is that you can fund real-world assets operated by people you don't know, safely
and transparently. It achieves this by ensuring every trust assumption is either **mathematically
removed**, **financially collateralized**, or **legally bound**.

That last word matters. Gally is not a "code is law" system — physical buildings and machinery are run
by people in a legal jurisdiction. So security is **dual-layer**: the mathematical certainty of the
blockchain *plus* the legal strength of the **[Smart Trust](/docs/smart-trust)** (a court-enforceable
contract). Code makes your capital safe; courts make the asset enforceable.

## The three pillars of trust

| Role | How far they're trusted | What backs it |
|---|---|---|
| **Entity** (the operator) | **Legally bound, computationally restricted.** Trusted to *execute the real-world project* as the Smart Trust dictates. | **Code + courts.** On-chain, funds reach them only via validator-approved tranches, and they post slashable collateral. Off-chain, they are legally liable under the Smart Trust. |
| **Validator** (the legal oracle) | **Trusted to enforce the Smart Trust** — to keep real-world reality matching the legal documents. | **Slashable collateral.** Their vouch is a financial bond; approving fraud or letting the legal documents fall out of compliance gets their USDC stake slashed to compensate investors. |
| **Admin** (the deployer) | **Trusted only with systemic parameters** (fee ceilings, stake floors, dispute settings). | **Hardcoded boundaries.** Can never touch escrow, mint deeds, move user funds, or override a dispute. |

You don't blindly trust the entity — you trust the entity *because* a validator has staked real capital
to vouch for the Smart Trust, and because that Smart Trust gives you standing in a real court.

## Core security primitives

**Capabilities are the keys.** Gally uses Sui's capability model instead of legacy "owner" addresses.
The three keys — `AdminCap`, `ValidatorCap`, `EntityCap` — are **soulbound**: they can't be wrapped,
sold, or transferred through generic code, eliminating the "admin key bought on a marketplace" vector.
Crucially, the `AdminCap` is a *parameter* key, not a *treasury* key — there is no function anywhere
that lets it spend escrow or mint shares.

**The asymmetric pause.** Gally has an emergency pause, but it is deliberately one-sided — a protocol
that can trap your funds behind an admin flag is not trustless. This one cannot:

- **Paused (entry halts):** creating projects, contributing, registering/vouching as a validator,
  releasing tranches, depositing revenue, wrapping.
- **Never paused (exits always open):** refunding/aborting a failed raise, claiming yield, unwrapping
  back to a deed, redeeming a closed deed, and resolving disputes.

**Cryptographic document attestation.** The Smart Trust's documents (master deeds, permits, invoices)
live on Walrus decentralized storage. Gally records not just the pointer but each document's
**`SHA-256` content hash**, and the validator signs that hash. Swap the file behind the same storage ID
and the mismatch is instantly detectable — and the validator who signed the original is financially on
the hook.

## The slashing & dispute engine

**Instant freeze & slashing.** When a validator vouches, they lock a percentage of their USDC stake as
**coverage**. They can never withdraw locked coverage, nor anything at all while frozen or slashed. The
instant any attestation is challenged, the whole pool freezes and all pending approvals are voided —
validators cannot run for the exit.

**The "Supreme Court" jury.** Anyone can challenge a validator's attestation by posting a fixed bond
and counter-evidence — and that challenge can target the **legal strength of the Smart Trust itself**
(see below), not only obvious fraud. A jury of other validators then votes:

- **One vote per staked pool** (not per wallet) — this defeats sybil attacks.
- **Upheld (guilty):** the validator's coverage is slashed; the challenger gets a bounty plus their
  bond back; the remainder flows to the compensation pool; the validator's pool is permanently retired.
- **Rejected (innocent):** the challenger's bond is forfeited — half to the wrongly-accused validator
  for the freeze, half to the jurors.
- **Expired (no quorum):** the challenger's bond is returned in full.

**Disputes reach the legal layer.** Because a vouch is a financial signature over the Smart Trust, a
dispute can contest that the physical contract failed to deliver, or that local laws changed and the
validator never updated the documents ("legal rot"). On-chain, an upheld dispute slashes the
*validator*; off-chain, the Smart Trust gives holders standing to pursue the *entity* in court. Two
complementary enforcement paths.

## The threat matrix: attacks & defenses

Every known attack vector has an explicit, enforced defense:

| Attack vector | Defense |
|---|---|
| **Entity absconds with the raise** | Capital only leaves via sequential, validator-approved tranches; undeployed escrow is seized on default. |
| **Validator–entity collusion** | Approve-then-withdraw separation gives a public dispute window; three layers (escrow → coverage → collateral) back compensation. |
| **Validator exit-scam** | Locked-stake floors + instant freeze-on-dispute mechanically block withdrawal. |
| **Stale / non-compliant Smart Trust ("legal rot")** | The validator's vouch is a *continuing* attestation; if laws change and documents aren't updated, a dispute slashes their coverage. |
| **Retroactive yield theft** (wrap in dry spells, unwrap for deposits) | Unwrap resets the deed's index to the current value → wrapped time earns exactly zero. |
| **Deposit sandwich** (unwrap right before a big deposit) | Damped by a wrap/unwrap cooldown; large depositors should split deposits over time. |
| **Receipt double-spend** (refund *and* claim) | Receipts are linear objects consumed by value — double-use is unrepresentable in Sui Move. |
| **Pre-minted coins breaking the 1:1 peg** | Finalize requires a virgin mint authority (zero supply), custodied inside the protocol forever. |
| **Off-spec entity token** (wrong decimals / mutable metadata) | Finalize asserts 6-decimal parity; the token's metadata is frozen at publish. |
| **Dispute spam to freeze honest validators** | A fixed bond, forfeited on a rejected challenge. |
| **Jury sybil** (one validator, many wallets) | One vote per *staked pool*, with a stake floor and target exclusion. |
| **Admin key compromise** | Hard caps on every parameter; no admin path touches funds; exits never pause. |
| **Stranded revenue when everyone is wrapped** | Rollover reserve + sweep on the first unwrap. |
| **Wrapped holders excluded from compensation** | Freeze wrapping + grace window + sweep so everyone can unwrap and share. |
| **File swapped behind a storage ID** | Validators sign the `SHA-256` content hash, not just the pointer. |
| **Integer overflow / rounding** | 128-bit scaled arithmetic, multiply-before-divide, explicit payout bound. |
| **Capital stranded by an absent counterparty** | Finalize, abort, flag-default, resolve, and sweep are all permissionless cranks. |

## The five rules that are never violated

These hold everywhere in the protocol, no matter the feature:

1. **No loops over holders.** Distribution is always O(1) via the index.
2. **Exits are never pause-checked.** The exit functions contain zero pause logic.
3. **All yield math is 128-bit, scaled, multiply-before-divide.** No floats, no silent overflow.
4. **The wrapped coin's supply always equals wrapped deeds.** The only mint authority lives inside the
   protocol forever; the only way to mint is to wrap.
5. **Deeds can only be minted inside the package.** Nothing external can fabricate a share.

## Honest limitations

No system is risk-free, and these are disclosed plainly:

- **Gally provides the infrastructure; courts provide the enforcement.** The on-chain rules are
  mathematically guaranteed, but the ultimate strength of any Smart Trust depends on its **jurisdiction**
  and on real-world legal process. Validators are bonded to keep the legal layer sound, and disputes
  slash them when it isn't — but a favorable court outcome is never guaranteed in advance.
- **The compensation grace window is a remedy, not a guarantee.** A holder who cannot unwrap before the
  window closes — e.g., coins locked as collateral in an external protocol they can't exit in time —
  permanently misses that distribution. The window is set generously (days, not hours), and the app
  alerts holders on dispute and default events.
- **Convert your receipt promptly.** If you wait a long time before turning a funding receipt into a
  deed, your yield index starts when you convert, not when you contributed.
- **Real-world execution risk remains.** Gally guarantees the on-chain rules and the *integrity* of the
  Smart Trust; it cannot physically force a building to be built. What it guarantees is that misbehavior
  is slashable and your capital is always exited or compensated.
- **Status:** the contracts are feature-complete with extensive test suites and currently run on Sui
  Devnet. A production-grade document layer and a mainnet publish remain ahead. See the [FAQ](/docs/faq).
