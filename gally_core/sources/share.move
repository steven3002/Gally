/// GallyShare — the digital deed (spec: protocol_flow.md §3.8).
///
/// Owned, freely transferable (`key + store` on purpose: the share is MEANT
/// to be composable — sold, collateralized, escrowed by third-party
/// protocols). `yield_claimed_index` is the entire claim-accounting state:
/// yield owed is always `(global index − personal index) × count`, so
/// transferring the object transfers exactly its unclaimed yield with it.
///
/// All constructors are `public(package)`: shares are minted only by receipt
/// conversion (M3 `claim_shares`) and unwrapping (M5) — nothing outside the
/// package can fabricate one. This restriction is itself a security property.
module gally_core::share;

// === Errors ===

/// Split amount must be non-zero and strictly less than the share count.
const EInvalidSplitAmount: u64 = 505;

// === Structs ===

/// Fractional ownership deed: 1 share == 1 USDC of original principal.
public struct GallyShare has key, store {
    id: UID,
    asset_id: ID,
    share_count: u64,
    /// Personal snapshot of the global index, scaled 1e9 (spec §15).
    yield_claimed_index: u128,
    /// Set on mint and on unwrap; enforces the wrap cooldown (spec §12).
    acquired_at_ms: u64,
}

// === Public Functions ===

/// Splits `amount` off into a new share object. The child inherits the
/// parent's index snapshot and acquisition time — the entitlement formula is
/// linear in `share_count`, so a split preserves total owed exactly, with no
/// claim needed (spec §8.1). Pure: returns the child for PTB composition
/// (e.g., split → wrap in one transaction, spec §12).
public fun split_share(share: &mut GallyShare, amount: u64, ctx: &mut TxContext): GallyShare {
    assert!(amount > 0 && amount < share.share_count, EInvalidSplitAmount);
    share.share_count = share.share_count - amount;
    GallyShare {
        id: object::new(ctx),
        asset_id: share.asset_id,
        share_count: amount,
        yield_claimed_index: share.yield_claimed_index,
        acquired_at_ms: share.acquired_at_ms,
    }
}

// === View Functions ===

public fun asset_id(share: &GallyShare): ID { share.asset_id }

public fun share_count(share: &GallyShare): u64 { share.share_count }

public fun yield_claimed_index(share: &GallyShare): u128 { share.yield_claimed_index }

public fun acquired_at_ms(share: &GallyShare): u64 { share.acquired_at_ms }

// === Package Functions ===

/// Mints a share. Callers: receipt conversion (M3), unwrap (M5).
public(package) fun mint(
    asset_id: ID,
    share_count: u64,
    yield_claimed_index: u128,
    acquired_at_ms: u64,
    ctx: &mut TxContext,
): GallyShare {
    GallyShare {
        id: object::new(ctx),
        asset_id,
        share_count,
        yield_claimed_index,
        acquired_at_ms,
    }
}

/// Destroys a share, returning its identity and count. Callers: wrap (M5),
/// redemption (M7).
public(package) fun burn(share: GallyShare): (ID, u64) {
    let GallyShare { id, asset_id, share_count, yield_claimed_index: _, acquired_at_ms: _ } =
        share;
    id.delete();
    (asset_id, share_count)
}

/// Advances the personal index snapshot after a claim (M4) or on unwrap (M5).
public(package) fun set_yield_claimed_index(share: &mut GallyShare, new_index: u128) {
    share.yield_claimed_index = new_index;
}

/// Adjusts the count during a merge (M4).
public(package) fun set_share_count(share: &mut GallyShare, new_count: u64) {
    share.share_count = new_count;
}
