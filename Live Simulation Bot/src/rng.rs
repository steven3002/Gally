//! A tiny, dependency-free PRNG (xorshift64*) for the activity generator's
//! weighted action selection and random target/user picks (SIM-M4).
//!
//! The bot is a *liveness* harness, not a fuzzer — it needs varied, not
//! cryptographic, randomness, so a 8-byte-state xorshift keeps the dependency
//! tree lean (consistent with the crate's "lean synchronous stack" choice).
//! Seedable for deterministic unit tests.

/// xorshift64* — fast, decent distribution, single u64 of state.
pub struct Rng {
    state: u64,
}

impl Rng {
    /// Seed from a non-zero value (a zero seed is bumped to a constant — the
    /// generator is degenerate at 0).
    pub fn new(seed: u64) -> Self {
        Rng {
            state: if seed == 0 { 0x9E3779B97F4A7C15 } else { seed },
        }
    }

    /// Seed from OS entropy (falls back to a fixed seed if the RNG is
    /// unavailable — the bot must still run).
    pub fn from_os() -> Self {
        let mut buf = [0u8; 8];
        let seed = match getrandom::getrandom(&mut buf) {
            Ok(()) => u64::from_le_bytes(buf),
            Err(_) => 0x1234_5678_9ABC_DEF0,
        };
        Rng::new(seed)
    }

    /// Next raw u64.
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in `[0, n)`. Returns 0 for `n == 0`.
    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }

    /// Pick a random index into a slice of length `len`, or `None` if empty.
    pub fn pick_index(&mut self, len: usize) -> Option<usize> {
        if len == 0 {
            None
        } else {
            Some(self.below(len as u64) as usize)
        }
    }

    /// Coin flip.
    pub fn flip(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_with_seed() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn test_below_range_and_empty() {
        let mut r = Rng::new(7);
        for _ in 0..1000 {
            assert!(r.below(5) < 5);
        }
        assert_eq!(r.below(0), 0);
        assert_eq!(r.pick_index(0), None);
        assert_eq!(r.pick_index(1), Some(0));
    }

    #[test]
    fn test_distribution_is_not_degenerate() {
        // Every bucket of a small range is hit over enough draws — guards
        // against a stuck generator.
        let mut r = Rng::new(123);
        let mut seen = [false; 6];
        for _ in 0..2000 {
            seen[r.below(6) as usize] = true;
        }
        assert!(seen.iter().all(|&b| b), "all buckets should be reachable");
    }
}
