//! The Dual-State Engine (`--pace`) — SIM-D8 / `protocol_flow.md §5.3`.
//!
//! Two mutually-exclusive runtime profiles bundle the bot's tick cadence, traffic
//! shape, and the time regime it expects the published protocol to enforce. This
//! module owns only the *flag → profile* parsing + the profile's cadence; the
//! parallel-cohort scheduler (real-world) and the high-throughput spam +
//! short-time coupling (accelerated) land in SIM-M3/M4.

use anyhow::{bail, Result};

/// The two runtime profiles of the Dual-State Engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pace {
    /// Time params are immutable laws; the bot waits them out and stays event-rich
    /// via parallel user cohorts. Low-frequency, organic traffic.
    RealWorld,
    /// Lifecycle speed-run: time params shrunk (AdminCap-first at genesis), tiny
    /// deadlines. High-throughput spam traffic.
    Accelerated,
}

/// Cadence + descriptive metadata derived from a [`Pace`].
pub struct PaceProfile {
    /// Default `TICK_INTERVAL_MS` for this profile (an explicit env/flag overrides it).
    pub default_tick_ms: u64,
    /// Human-readable traffic shape (for logs / operator clarity).
    pub traffic: &'static str,
    /// Human-readable time regime (for logs / operator clarity).
    pub time_regime: &'static str,
}

impl Pace {
    /// Parse a `--pace` / `PACE` value (case-insensitive, `_`/`-` interchangeable).
    pub fn parse(s: &str) -> Result<Pace> {
        match s.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "real-world" | "realworld" | "real" => Ok(Pace::RealWorld),
            "accelerated" | "rapid" | "fast" => Ok(Pace::Accelerated),
            other => bail!("unknown --pace '{other}': expected 'real-world' or 'accelerated'"),
        }
    }

    /// Canonical lower-case name.
    pub fn as_str(self) -> &'static str {
        match self {
            Pace::RealWorld => "real-world",
            Pace::Accelerated => "accelerated",
        }
    }

    /// The cadence + metadata for this profile.
    pub fn profile(self) -> PaceProfile {
        match self {
            Pace::RealWorld => PaceProfile {
                default_tick_ms: 30_000,
                traffic: "low-frequency / organic (parallel cohorts)",
                time_regime: "production time params (immutable laws)",
            },
            Pace::Accelerated => PaceProfile {
                default_tick_ms: 2_000,
                traffic: "high-throughput spam",
                time_regime: "shrunk time params (AdminCap-lowered at genesis; e.g. 7d -> 45s)",
            },
        }
    }
}

impl Default for Pace {
    fn default() -> Self {
        Pace::RealWorld
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pace_parse() {
        assert_eq!(Pace::parse("real-world").unwrap(), Pace::RealWorld);
        assert_eq!(Pace::parse("ACCELERATED").unwrap(), Pace::Accelerated);
        assert_eq!(Pace::parse("real_world").unwrap(), Pace::RealWorld);
        assert_eq!(Pace::parse("  rapid ").unwrap(), Pace::Accelerated);
        assert!(Pace::parse("warp").is_err());

        // default is the safe, production-faithful profile
        assert_eq!(Pace::default(), Pace::RealWorld);

        // each profile yields its expected default cadence; accelerated is faster
        assert_eq!(Pace::RealWorld.profile().default_tick_ms, 30_000);
        assert_eq!(Pace::Accelerated.profile().default_tick_ms, 2_000);
        assert!(Pace::Accelerated.profile().default_tick_ms < Pace::RealWorld.profile().default_tick_ms);
    }
}
