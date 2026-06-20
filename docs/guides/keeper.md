---
title: "Keeper & Maintenance (Cranks)"
part: "Use"
order: 10
summary: "The permissionless 'anyone can poke the protocol' actions — finalize, abort, sweeps, flag-default, resolve, close — what each one does, when it's needed, and how to run one from the explorer's Cranks page."
keywords: ["crank", "keeper", "permissionless", "finalize", "abort", "sweep rollover", "sweep compensation", "flag default", "resolve dispute", "close asset", "maintenance"]
---

# Keeper & Maintenance (Cranks)

Some of the protocol's actions don't belong to any single party — they just need to happen once their
on-chain conditions are met. Gally makes these **permissionless**: *anyone* can call them. We call them
**cranks**, because you're turning the handle that moves the protocol forward.

## Why cranks exist

A trustless protocol can't depend on a privileged operator to push state along — if it did, that
operator could stall or strand funds. So Gally exposes the housekeeping steps to everyone. The practical
guarantee is: **one honest actor plus an expired deadline is always enough** to advance any project,
release a refund path, or distribute funds. You never have to wait on the entity, the validator, or
the admin to get what you're owed.

Running a crank costs you only gas; the *effect* benefits whoever the action is for (often other
people). Bots and engaged community members typically keep these turning, but you can always do it
yourself.

## The crank catalog

| Crank | When it's available | What it does |
|---|---|---|
| **Finalize a raise** | The raise has hit its goal before the deadline. | Locks in the raise, creates the project's yield accumulator, and moves it to building. Lets contributors claim their deeds. |
| **Abort a failed raise** | The deadline passed and the goal wasn't met. | Marks the raise failed so every contributor can refund, and returns the entity's collateral. |
| **Sweep rollover** | Revenue is parked (it arrived while everyone was wrapped) and someone is now unwrapped. | Pushes the parked revenue through the index so it can be claimed. (This also happens automatically on the first unwrap.) |
| **Sweep compensation** | A grace window has elapsed and a compensation pool is waiting. | Distributes slashed/seized funds to holders through the index and unfreezes wrapping. |
| **Flag a default** | A tranche deadline passed with no approved proof. | Seizes the entity's collateral and undeployed escrow into the compensation pool and starts the grace window. |
| **Resolve a dispute** | The dispute's voting deadline has passed. | Tallies the jury, applies the verdict (slash + compensate, or return/forfeit the bond), and unfreezes as appropriate. |
| **Close at target** | A term-financing project has paid investors up to its return target. | Ends the project, returns the entity's collateral, and opens redemptions. |
| **Close after compensation** | Compensation has been fully swept after a default. | Moves the project to closed and opens redemptions. |

## Using the Cranks page

The explorer's **Cranks** page reads live on-chain state and shows you which cranks are **available
right now** and why — for example, "this raise is fully funded and can be finalized," or "this dispute's
voting window has closed and can be resolved." Pick one, sign the transaction, and the protocol moves
forward. Each project, token, and dispute page also surfaces the cranks relevant to it.

If nothing is available, that's normal — it means every project is already in a settled state and there
is no handle to turn yet.
