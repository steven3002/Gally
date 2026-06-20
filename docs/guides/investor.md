---
title: "Investor Guide"
part: "Use"
order: 8
summary: "Every action a holder performs, step by step: contribute, claim your deeds, refund, claim yield, wrap and unwrap for liquidity, split and merge, and redeem — with what you'll see and what can go wrong."
keywords: ["investor", "contribute", "claim shares", "claim deed", "refund", "claim yield", "wrap", "unwrap", "split", "merge", "redeem", "exit", "how to invest"]
---

# Investor Guide

This is the complete playbook for an investor. Each action lists the steps, what you'll see, and what
can go wrong. Every one of these is a transaction your wallet signs; the app never holds your keys.

## Contribute to a raise

**When:** the project is in `FUNDING` and the deadline hasn't passed.

1. Open the project and choose **Contribute**.
2. Enter the USDC amount and sign.
3. You receive a soulbound **receipt** recording exactly what you put in.

- *What you'll see:* your contribution added to the raise progress, and a receipt in your wallet.
- *Good to know:* if you contribute more than the project needs to reach its goal, only what's needed
  is accepted and **the excess is returned in the same transaction** — you can't accidentally overshoot.
- *Can't contribute?* The raise may have hit its goal, passed its deadline, or the protocol may be
  paused (contributing is one of the actions a pause halts).

## When the raise succeeds — claim your deeds

**When:** the raise has been finalized (state `EXECUTING` or later).

1. Go to your receipt (Portfolio) and choose **Claim Deed**.
2. Sign. Your receipt is burned and a `GallyShare` deed is minted to your wallet.

- *Convert promptly.* Your deed's yield clock starts when you convert, not when you contributed. If you
  wait weeks into operations before claiming, you forgo the yield accrued before your deed existed.
- *Multiple receipts* (from contributing more than once) each convert independently.

## When the raise fails — refund

**When:** the project is in `FAILED` (deadline passed without hitting goal).

1. Open your receipt and choose **Refund**.
2. Sign. Your receipt is burned and your **full principal** is returned.

- *This exit can never be paused.* The all-or-nothing guarantee means a failed raise always returns
  every contributor's money in full.

## Claim your yield

**When:** the project is `OPERATIONAL` (or later) and revenue has been deposited.

1. Open a deed (or your Portfolio) and choose **Claim Yield**.
2. Sign. Your owed USDC is transferred to you, and the deed's claim marker advances.

- *Claiming is always safe.* If there's nothing to claim yet, it's a harmless no-op — so batching a
  claim with other actions never fails on a zero day.
- *Never pause-gated.* You can always claim, even during an emergency pause.

## Wrap for liquidity — and unwrap back

A deed can be **wrapped** into a plain `Coin<T>` you can trade or use as collateral elsewhere, then
**unwrapped** back into a deed. (For the full picture — the mechanism, the conditions, the DeFi use
cases, and why the coin is trustworthy collateral — see
[Wrapping, Liquidity & Collateral](/docs/wrapping).)

**Wrap:**
1. Choose **Wrap** on a deed and sign.
2. Any pending yield is automatically claimed to you first, the deed is consumed, and you receive a
   `Coin<T>` of the same amount.

**Unwrap:**
1. Choose **Unwrap** on your coins and sign.
2. The coins are burned and a fresh deed is minted back to you.

- *The trade-off:* **wrapped coins earn no yield.** While wrapped you're fully liquid but excluded from
  distributions; unwrapped holders' yield is amplified by what you forfeit (the Diamond-Hand effect).
- *No retroactive yield:* an unwrapped deed earns **zero** for the time it spent wrapped — guaranteed.
- *Cooldown:* a short minimum duration applies between wrapping and unwrapping (a defense against
  oscillating around big deposits). If you just wrapped, you may need to wait briefly to unwrap.
- *Frozen wrapping:* during a compensation grace window, wrapping is temporarily frozen so everyone can
  unwrap and receive their share — unwrapping still works.

## Split and merge deeds

- **Split:** divide one deed into two (e.g., to wrap only part of a position). Both pieces keep the
  parent's yield history, so nothing is lost.
- **Merge:** combine two deeds for the same project into one. Any pending yield on both is claimed
  first. The merged deed keeps the **more recent** acquisition time, so merging can't be used to dodge
  the wrap cooldown.

## After a project closes — redeem

**When:** the project is `CLOSED`.

1. Choose **Redeem** on your deed and sign.
2. Any final yield is claimed to you and the deed is burned.

## How do I exit — always?

Your exit depends on the project's state; there is always one where your money is at risk:

| State | Your exit |
|---|---|
| `FUNDING` (then `FAILED`) | **Refund** your full principal |
| `OPERATIONAL` | **Claim yield**; sell, transfer, or **unwrap** your deed |
| `DEFAULTED` / `COMPENSATING` | **Unwrap** during the grace window, then **claim** your compensation |
| `CLOSED` | **Redeem** your deed |

See [The Asset Lifecycle](/docs/lifecycle) for what each state means.
