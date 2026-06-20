---
title: "Introduction"
part: "Understand"
order: 1
summary: "What Gally is in two minutes — pool USDC, fund real projects, hold a yield-paying digital deed — and where to go next."
keywords: ["what is gally", "overview", "introduction", "rwa", "real world assets", "sui", "yield", "digital deed", "getting started"]
---

# Welcome to Gally

**Gally is a decentralized capital protocol on the Sui blockchain.** It lets ordinary people pool
**USDC** to fund vetted real-world projects — housing, machinery, trade finance, agriculture, energy,
infrastructure — and in return hold a **digital deed** that pays out the project's yield. The deed is
a real object in your own wallet, not a balance on someone else's spreadsheet.

If you have two minutes, this page is the whole idea. If you want to *do* something, jump to
[Getting Started](/docs/getting-started).

## The problem Gally solves

Real-world-asset (RWA) yield has always been closed to retail investors. The deals are large, they
are illiquid, and they require you to **trust an operator** to actually pay you back. Gally removes,
collateralizes, or **legally binds** every one of those trust assumptions. It tackles two long-standing
problems at once:

- **The trust paradox** — *how can on-chain money trust an off-chain business?* Every asset is bound by
  a **[Smart Trust](/docs/smart-trust)** — a legally binding, court-enforceable contract — and a network
  of **validators** stake hard collateral to vouch for its legal strength and keep it compliant. Vouch
  for something false and they're slashed and you're compensated. Trust shifts from the operator's
  goodwill to staked capital *plus* a real legal contract.
- **The liquidity paradox** — *how does a custom yield-bearing asset work with normal DeFi?* Gally
  lets you **wrap** your deed into a plain, fully tradable coin whenever you want liquidity, and
  unwrap it back when you want yield again.

## The "Two Triangles"

Gally balances community capital against strict enforcement using two complementary halves:

![The Two Triangles — Triangle 1 (Community · capital formation) and Triangle 2 (Repercussion · governance & enforcement)](/two-triangles.png)

- **Triangle 1 — Community (capital formation).** Many people pool small amounts of USDC into a shared
  on-chain escrow. Trust is placed in the smart contract *and* the asset's legally binding Smart Trust —
  not the operator's goodwill. Money is released only as real milestones are met.
- **Triangle 2 — Repercussion (governance & enforcement).** Rules fix the timeline, the revenue split,
  and the fees. Revenue is streamed automatically to deed-holders. And anyone who fails their
  obligations — a builder who misses a deadline, a validator who vouches for a fraud — has their staked
  collateral slashed to compensate investors.

## The four people in the system

| Role | What they do |
|---|---|
| **Investor** | Pools USDC, receives a deed, claims yield, can wrap for liquidity, and can always exit. |
| **Entity** (builder / business) | Operates the real asset under a legally binding **Smart Trust**; unlocks funding only as validator-approved milestones are met; posts its own collateral. |
| **Validator** | A decentralized legal oracle — stakes USDC to vouch for the asset's **Smart Trust** (its legal strength & compliance) and to approve milestones. Slashed if the legal reality stops matching the tokens. |
| **Challenger** | Anyone who spots fraud and posts a bond to open a dispute. |

## The trust thesis, in one line

> **You don't blindly trust the operator — you trust a *validator* who has staked real capital to vouch
> for the asset's legally binding [Smart Trust](/docs/smart-trust), backed by an *admin* trusted only
> with parameters, never with your money.**

This is a **dual-layer** model. On-chain, your capital is mathematically safe — every place it sits at
risk has a **permissionless exit that can never be paused** (refund, claim, unwrap, redeem). Off-chain,
the **Smart Trust** makes the real-world asset legally enforceable, so the tokens are backed by a
defensible reality, not a promise.

## How to read these docs

The docs are organized in four parts. **Press `/` or ⌘K anywhere to search.**

- **Understand** — the concepts, the **[Smart Trust](/docs/smart-trust)** legal layer, the
  [lifecycle](/docs/lifecycle), the [economic model](/docs/economics), and the
  [trust & security model](/docs/security). Start here to learn *how it works*.
- **Use** — [getting started](/docs/getting-started), step-by-step guides for
  [investors](/docs/guides/investor) and [challengers](/docs/guides/challenger), the
  [explorer tour](/docs/explorer), and six [worked examples](/docs/scenarios). Read this to learn
  *what to do*.
- **Build & Operate** — the [system architecture](/docs/architecture) and how to [run it](/docs/run).
- **Reference** — the [FAQ](/docs/faq), [glossary](/docs/glossary), and [parameters](/docs/parameters).

New here and just want to invest? Read [Core Concepts](/docs/concepts), then go straight to
[Getting Started](/docs/getting-started).
