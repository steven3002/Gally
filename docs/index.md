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
are illiquid, and they require you to **trust an operator** to actually pay you back. Gally removes or
collateralizes every one of those trust assumptions. It tackles two long-standing problems at once:

- **The trust paradox** — *how can on-chain money trust an off-chain business?* Gally answers with a
  network of **validators** who stake hard collateral to vouch that a project's legal documents are
  real. If they lie, they are slashed and you are compensated. Trust shifts from the business to
  staked capital.
- **The liquidity paradox** — *how does a custom yield-bearing asset work with normal DeFi?* Gally
  lets you **wrap** your deed into a plain, fully tradable coin whenever you want liquidity, and
  unwrap it back when you want yield again.

## The "Two Triangles"

Gally balances community capital against strict enforcement using two complementary halves:

- **Triangle 1 — Community (capital formation).** Many people pool small amounts of USDC into a shared
  on-chain escrow. Trust is placed in the smart contract, not the builder. Money is released only as
  real milestones are met.
- **Triangle 2 — Repercussion (governance & enforcement).** Rules fix the timeline, the revenue split,
  and the fees. Revenue is streamed automatically to deed-holders. And anyone who fails their
  obligations — a builder who misses a deadline, a validator who vouches for a fraud — has their staked
  collateral slashed to compensate investors.

## The four people in the system

| Role | What they do |
|---|---|
| **Investor** | Pools USDC, receives a deed, claims yield, can wrap for liquidity, and can always exit. |
| **Entity** (builder / business) | Lists a project, hits milestones to unlock funding, and pays revenue back in. Posts its own collateral. |
| **Validator** | Stakes USDC to vouch that a project's legal documents are authentic, and approves milestones. Slashed if they lie. |
| **Challenger** | Anyone who spots fraud and posts a bond to open a dispute. |

## The trust thesis, in one line

> **The entity is never trusted, the validator is trusted only up to their locked stake, and the admin
> is trusted only with parameters — never with your money.**

Every place your capital is at risk has a **permissionless exit that can never be paused**: you can
always refund, claim, unwrap, or redeem.

## How to read these docs

The docs are organized in four parts. **Press `/` or ⌘K anywhere to search.**

- **Understand** — the concepts, the [lifecycle](/docs/lifecycle), the [economic model](/docs/economics),
  and the [trust & security model](/docs/security). Start here to learn *how it works*.
- **Use** — [getting started](/docs/getting-started), step-by-step guides for
  [investors](/docs/guides/investor) and [challengers](/docs/guides/challenger), the
  [explorer tour](/docs/explorer), and six [worked examples](/docs/scenarios). Read this to learn
  *what to do*.
- **Build & Operate** — the [system architecture](/docs/architecture) and how to [run it](/docs/run).
- **Reference** — the [FAQ](/docs/faq), [glossary](/docs/glossary), and [parameters](/docs/parameters).

New here and just want to invest? Read [Core Concepts](/docs/concepts), then go straight to
[Getting Started](/docs/getting-started).
