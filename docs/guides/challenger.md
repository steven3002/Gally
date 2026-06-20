---
title: "Challenger Guide"
part: "Use"
order: 10
summary: "How any user polices the validators: what you can challenge and when, posting a bond and evidence, what happens during the jury vote, and exactly what you win or lose under each verdict."
keywords: ["challenger", "dispute", "challenge validator", "bond", "evidence", "jury", "slashing", "bounty", "fraud", "how to dispute"]
---

# Challenger Guide

The protocol stays honest because **anyone** can challenge a validator who vouched for something false.
This guide is for that person — the challenger. You don't need to be a validator or a holder; you need
evidence and a bond.

## What you can challenge, and when

You challenge a **validator's attestation** on a specific project. Because that attestation vouches for
the asset's **[Smart Trust](/docs/smart-trust)** — its legal strength and ongoing compliance — you can
contest far more than obvious fraud:

- a forged permit, or a milestone that was approved but never actually happened;
- the **Smart Trust failing to deliver** what it legally promised; or
- **legal rot** — local laws changed and the validator never updated the documents to keep the asset
  compliant.

Conditions:

- The project must be in **`EXECUTING`** or **`OPERATIONAL`**, with the validator's coverage still
  locked against it. (During `FUNDING` there's nothing to dispute — contributors are already protected
  by the full-refund guarantee.)
- There can be **one open dispute per (project, validator)** at a time.

## How to open a dispute

1. Gather your counter-evidence and store it on Walrus (the explorer/app helps you reference it).
2. Open the project or the validator and choose **Open Dispute**.
3. Post the **challenger bond** — a fixed USDC amount set by the protocol (shown on the Governance
   page) — and attach your evidence reference. Sign.

- *Why a fixed bond?* It makes the cost of challenging predictable and prices out spam: a frivolous
  challenge loses the bond.

## What happens next

1. The targeted validator's pool **freezes immediately** — all of their pending approvals everywhere
   are voided — and the project's tranche releases halt.
2. A **jury** of other validators votes guilty or innocent. Each staked pool gets one vote; the
   accused validator can't vote on their own case.
3. After the **voting deadline**, anyone can resolve the dispute. (Resolution waits for the deadline so
   late votes can't be front-run.)

You can follow the live tally on the dispute page in the explorer.

## What you win or lose

| Verdict | What it means | Your money |
|---|---|---|
| **Upheld** | The jury agreed the validator was guilty. | You get a **bounty** (a percentage of the slashed amount) **plus your bond back**. The rest compensates investors. |
| **Rejected** | The jury found the validator innocent. | You **lose your bond** — half goes to the jurors, half to the wrongly-accused validator. |
| **Expired** | The jury never reached quorum by the deadline. | Your **bond is returned in full** — you're not punished for the jury failing to show up. |

## After an upheld challenge

The guilty validator's coverage is slashed and their pool is permanently marked as slashed. The slashed
funds (beyond your bounty) flow into a **compensation pool** for the project's investors, distributed
through the yield index after a grace window. If the project was still building, it moves onto the
compensation path; if it was already operational, revenue keeps flowing to investors. See
[Trust & Security](/docs/security) for the full dispute mechanics.
