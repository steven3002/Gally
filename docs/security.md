---
title: "Trust & Security Model"
part: "Understand"
order: 5
summary: "Why a stranger can trust Gally with money: bounded trust assumptions, capability keys, validator slashing, the dispute jury, the asymmetric pause, the five rules that are never violated, document attestation, the full attack/defense table, and the honest limitations."
keywords: ["security", "trust", "is it safe", "slashing", "capabilities", "admincap", "pause", "jury", "dispute", "attacks", "sha256", "walrus", "limitations", "audit"]
---

# Trust & Security Model

Gally's central claim is that you can fund a real-world project run by people you don't know, and still
be safe. This page explains why. The short version: **every trust assumption is either removed or
backed by collateral, and you can always get out.**

## The three trust assumptions

| Who | How far they're trusted | What backs it |
|---|---|---|
| **Entity** (the builder/business) | **Not at all.** | They receive money only through validator-approved tranches, and they post their own slashable collateral. |
| **Validator** | **Only up to their locked stake.** | Their attestation is a financial bond; lying gets it slashed to compensate you. |
| **Admin** | **Only with parameters.** | Hard-capped settings; the admin can never touch escrows, mint deeds, move your funds, or override a dispute. |

## Capabilities are the keys

Gally uses Sui's capability model instead of an "owner" address. There are three keys —
`AdminCap`, `ValidatorCap`, and `EntityCap` — and each is **soulbound**: it has no `store` ability, so
it cannot be wrapped, sold, or transferred through generic code. This eliminates the "admin key bought
on a marketplace" class of failure. Crucially, the `AdminCap` is a *parameter* key, not a *treasury*
key — there is no function, anywhere, that lets it spend escrow or mint shares.

## Validator stake & slashing

A validator runs a **pool** of USDC stake. When they vouch for a project they lock a portion of it as
**coverage** for that specific project. The locked amount can never exceed their total stake, and they
can only withdraw *free* (unlocked) stake — never below the minimum while they have active vouches, and
**never at all while frozen or slashed**. The instant any one of their attestations is challenged, the
whole pool freezes and every pending approval they have is void. This is what stops a validator from
running for the exit after a bad vouch.

## The "Supreme Court": disputes & the jury

Anyone can challenge a validator's attestation by posting a **fixed bond** and counter-evidence:

- The targeted pool **freezes** immediately and the project's tranche releases halt.
- A **jury** of other validators votes — **one vote per staked pool** (not per address, which defeats
  sybils), with a minimum-stake floor for eligibility, and the targeted validator excluded.
- Resolution happens after the voting deadline. A verdict requires a **quorum** of jurors and a
  super-majority **guilty threshold** (always more than half).

Outcomes:

- **Upheld** — the validator's coverage is slashed. The challenger receives a bounty plus their bond
  back; the rest flows to a compensation pool for investors; the validator's pool is permanently
  marked slashed.
- **Rejected** — the bond is forfeited: half to the jurors who voted, half to the wrongly-accused
  validator as compensation for the freeze.
- **Expired** — if the jury never reached quorum, the bond is returned to the challenger (they
  shouldn't be punished for juror apathy).

## The asymmetric pause

Gally has an emergency pause, but it is **deliberately one-sided**. Pausing halts capital *entry* but
**never** capital *exit*:

- **Paused (entry halts):** creating a project, contributing, registering/vouching as a validator,
  releasing a tranche, depositing revenue, wrapping.
- **Never paused (exit always works):** refunding a failed raise, aborting a failed raise, claiming
  yield, unwrapping back to a deed, redeeming a closed deed, and resolving disputes.

A protocol that could trap your funds behind an admin flag would not be trustless. This one cannot.

## The five rules that are never violated

These hold in every part of the protocol, no matter the feature:

1. **No loops over holders.** Distribution is always O(1) via the index — never iteration over
   contributors or deeds.
2. **Exits are never pause-checked.** The exit functions contain zero pause logic.
3. **All yield math is 128-bit, scaled, multiply-before-divide.** No floats, no silent overflow.
4. **The wrapped coin's supply always equals wrapped deeds.** The only mint authority lives inside the
   protocol forever, and the only way to mint is to wrap.
5. **Deeds can only be minted inside the package.** Nothing external can fabricate a share.

## Document attestation

Real-world documents (deeds, permits, invoices) live on Walrus decentralized storage. The protocol
records not just the blob pointer but its **sha256 content hash**, and the validator signs *that hash*.
So if someone swaps the file behind the same storage ID, the mismatch is detectable — and the validator
who signed the original is on the hook. Attestation pins content, not just a link.

## Attacks & defenses

Every known attack against a protocol like this has an explicit, enforced defense:

| Attack | Defense |
|---|---|
| Entity absconds with the raise | Money only leaves via sequential validator-approved tranches; undeployed escrow is seizable on default. |
| Validator–entity collusion (fake approvals) | Approve-then-withdraw separation gives a public dispute window; three layers (escrow, coverage, collateral) back compensation. |
| Validator exit-scam (withdraw after a bad vouch) | Locked-stake floor + instant freeze-on-dispute block the withdrawal. |
| Retroactive yield theft (wrap in dry spells, unwrap for deposits) | Unwrap sets the deed's index to the current value → wrapped time earns exactly zero. |
| Deposit sandwich (unwrap right before a big deposit) | Legitimate exposure, but damped by a wrap/unwrap cooldown; large depositors should split deposits over time. |
| Receipt double-spend (refund *and* claim) | Receipts are linear objects consumed by value — double-use is unrepresentable in Move. |
| Pre-minted coins breaking the 1:1 peg | Finalize requires a *virgin* mint authority (zero existing supply); it is then custodied forever. |
| Off-spec entity token (wrong decimals / mutable metadata) | Finalize asserts 6-decimal parity; the token's metadata is frozen at publish. |
| Dispute spam to freeze honest validators | A fixed bond, forfeited on a rejected challenge. |
| Jury sybil (one validator, many wallets) | One vote per *staked pool*, with a stake floor and target exclusion. |
| Admin key compromise | Hard caps on every parameter; no admin path touches funds; exits never pause. |
| Stranded revenue when everyone is wrapped | Rollover reserve + sweep on the first unwrap. |
| Wrapped holders excluded from compensation | Freeze wrapping + grace window + sweep so everyone can unwrap and share. |
| File swapped behind a storage ID | Validators sign the content hash, not just the pointer. |
| Integer overflow in the math | 128-bit arithmetic, explicit payout bound, documented capacity limit. |
| Capital stranded by an absent counterparty | Finalize, abort, flag-default, resolve, and sweep are all permissionless. |

## Honest limitations

No system is risk-free, and these are disclosed plainly:

- **The compensation grace window is a remedy, not a guarantee.** A holder who cannot unwrap before the
  window closes — for example, coins locked as collateral in an external protocol they can't exit in
  time — permanently misses that distribution. The window is set generously (days, not hours), and the
  explorer alerts holders on dispute and default events.
- **Convert your receipt promptly.** If you wait a long time before turning a funding receipt into a
  deed, your yield index starts when you convert, not when you contributed.
- **Real-world execution risk remains real.** Gally guarantees the *on-chain* rules; it cannot force a
  building to be built. What it guarantees is that misbehavior is slashable and your capital is exited
  or compensated.
- **Status:** the contracts are feature-complete with extensive test suites and currently run on Sui
  Devnet. A real document layer and a mainnet publish remain before production. See the
  [FAQ](/docs/faq).
