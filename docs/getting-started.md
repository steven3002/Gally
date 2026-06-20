---
title: "Getting Started"
part: "Use"
order: 6
summary: "Zero to your first action: connect a Sui wallet, understand which network you're on, claim test USDC, and contribute to your first project — all in about five minutes."
keywords: ["getting started", "connect wallet", "test usdc", "faucet", "claim tokens", "devnet", "first contribution", "how to start", "onboarding"]
---

# Getting Started

This page takes you from nothing to your first on-chain action. No prior blockchain experience is
assumed beyond having a wallet.

## What you need

- **A Sui wallet** (for example, the Sui Wallet browser extension). The Gally explorer is a
  **non-custodial dApp**: it *builds* a transaction, your wallet asks you to *sign* it, and the
  network executes it. The app never holds your keys and never moves funds without your signature.
- A little gas (SUI) and some **USDC** to invest. On the test network, both are free — see below.

## Which network am I on?

Gally currently runs on **Sui Devnet**, a free public test network. That means:

- The USDC here is **test USDC** with no real-world value — perfect for trying everything safely.
- **Devnet is wiped periodically** (roughly weekly). After a reset, the demo projects and your test
  balances are gone and the protocol is re-published with fresh addresses. This is expected on a test
  network; nothing is "lost" because nothing here has real value.

When Gally launches on mainnet, the settlement coin becomes real Circle USDC and the same flows apply.

## Get test USDC

On Devnet the explorer shows a **banner** for first-time visitors. Use the **Claim Tokens** action to
mint yourself some test USDC straight from the on-chain faucet — your wallet will prompt you to sign a
single transaction, and the USDC lands in your wallet. (If you also need gas, use the standard Sui
Devnet faucet for a little SUI.)

> Mintable USDC is a **test-network convenience only**. On mainnet, USDC is the real asset and cannot
> be minted by anyone.

## Your first five minutes

1. **Open the explorer and connect your wallet** (top-right Connect button).
2. **Claim test USDC** from the Devnet banner.
3. **Go to the Marketplace** (the Assets list) and pick a project in the **`FUNDING`** state.
4. **Contribute.** Enter an amount and sign. If you offer more than the project needs to hit its goal,
   the extra is returned to you in the same transaction. You'll receive a soulbound **receipt**.
5. **Watch it finalize.** Once the goal is met, anyone can finalize the raise (you can do it yourself
   from the Cranks page). After finalization, **claim your deed** — your receipt converts into a
   `GallyShare` in your wallet.
6. **Track it in your Portfolio.** Your deeds, any wrapped balances, and your claimable yield all show
   up under Portfolio once connected.

That's the whole on-ramp. From here, the [Investor Guide](/docs/guides/investor) covers every action
in detail, and [Reading the Explorer](/docs/explorer) tours the rest of the app.
