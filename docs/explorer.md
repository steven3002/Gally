---
title: "Reading the Explorer"
part: "Use"
order: 12
summary: "A guided tour of the Gally explorer: the marketplace, an asset page, validators, governance, your portfolio, disputes, tokens, cranks, the activity feed, and universal search and ID resolution."
keywords: ["explorer", "app tour", "marketplace", "assets", "asset page", "validators", "governance", "portfolio", "disputes", "tokens", "cranks", "activity", "search", "navigation"]
---

# Reading the Explorer

The Gally explorer is both a public block explorer (read anything, no wallet needed) and an investor
dApp (connect a wallet to transact). This page is a tour of what each part shows you. These very docs
live inside the explorer — so everything here is one click away.

## Marketplace (the Assets list)

The front door. Every project is listed with its name, category, state, funding progress, and key
numbers. Projects are grouped across six **categories** — housing, machinery, trade finance,
agriculture, energy, and infrastructure — and you can filter and search to find one in the state you
care about (for example, open `FUNDING` raises to invest in, or `OPERATIONAL` projects paying yield).

## An asset page

The deepest view in the explorer. For one project you'll find:

- **State & health** — where it is in its lifecycle, plus a solvency reading (is the reward pool fully
  backing what it owes?) and, where relevant, default-risk and grace-window countdowns.
- **The tranche timeline** — each milestone, its deadline, whether it's been proven and approved, and
  its release, with links to the on-chain proof documents.
- **Legal documents** — the validator-attested Walrus references, with their content hashes.
- **Revenue & yield** — the deposit history, the index curve, and the three-way split (protocol fee →
  investors → entity) for each deposit.

## Validators

The validator registry lists every pool with its stake, locked coverage, and status. A validator page
shows that validator's full **track record** — the projects they've vouched, the milestones they've
approved, and any disputes — so you can assess them before trusting their projects.

## Governance

Every protocol **parameter** at its current value, the pause status, and the on-chain history of every
parameter change. This is the page to check the live challenger bond, fee rate, jury rules, and grace
window — see the [Parameters Reference](/docs/parameters) for what each one means.

## Portfolio

Connect your wallet and this becomes your personal dashboard: your **deeds**, any **wrapped** balances,
and your **claimable yield**, computed against the live on-chain index. From here you can claim, wrap,
unwrap, split, merge, refund, and redeem. You can also view *any* address's public holdings and
activity.

## Disputes

Each dispute page shows the challenger's evidence, the **live vote tally** as jurors weigh in, the
voting deadline, and the final verdict — plus links to the validator and project involved.

## Tokens

For each operational project that has a token, the tokens view shows total deed supply, how much is
currently **wrapped** versus unwrapped, the wrap ratio over time, and the accumulator's yield index —
the engine behind the Diamond-Hand effect.

## Cranks & Activity

- **Cranks** — the permissionless maintenance actions that are *available right now* and why. See the
  [Keeper guide](/docs/guides/keeper).
- **Activity** — a live, protocol-wide feed of everything happening: contributions, claims, wraps,
  revenue deposits, disputes, and more.

## Universal navigation

- **Every ID is clickable** — addresses, object IDs, and transaction digests link straight to their
  page.
- **Object and transaction resolvers** — paste any object ID or tx digest to jump to a dedicated view
  of it.
- **Search** — press ⌘K for the global search to jump to any project, validator, address, or
  transaction. (And press `/` for the docs search you're reading now.)
