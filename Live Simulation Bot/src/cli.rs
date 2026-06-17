//! Minimal hand-rolled CLI parsing (no `clap` — keeps the build lean).
//!
//! Flags:
//!   --pace <real-world|accelerated>   Dual-State Engine profile (SIM-D8)
//!   --pace=<...>                      same, `=` form
//!   --tick-ms <u64>                   override the profile's default tick cadence
//!   --check                           connect, read the faucet, report, then exit
//!   --once                            run exactly one re-seed tick, then exit
//!   -h, --help

use anyhow::{anyhow, bail, Result};

use crate::pace::Pace;

#[derive(Debug, Default)]
pub struct Cli {
    pub pace: Option<Pace>,
    pub tick_override: Option<u64>,
    pub check: bool,
    pub once: bool,
    /// SIM-M3: ensure a vouched FUNDING asset is seeded, then run the user-cohort
    /// claim+contribute funding loop (one pass), then exit.
    pub fund: bool,
    /// SIM-M3: full genesis — seed an asset in every lifecycle state (+ K validators,
    /// AdminCap time-warp, non-zero yield index), then exit.
    pub seed_all: bool,
    /// SIM-M4: the activity daemon — continuous weighted-random mock-transaction
    /// loop driving real `gally_core` activity from the fake-user cohort.
    pub daemon: bool,
    /// Bound the daemon (and the re-seed loop) to N ticks, then exit (`None` =
    /// run forever). Used for CI-style soaks.
    pub cycles: Option<u64>,
}

impl Cli {
    pub fn parse<I: Iterator<Item = String>>(args: I) -> Result<Cli> {
        let mut cli = Cli::default();
        let mut it = args;
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--pace" => {
                    let v = it.next().ok_or_else(|| anyhow!("--pace requires a value"))?;
                    cli.pace = Some(Pace::parse(&v)?);
                }
                s if s.starts_with("--pace=") => {
                    cli.pace = Some(Pace::parse(&s["--pace=".len()..])?);
                }
                "--tick-ms" => {
                    let v = it.next().ok_or_else(|| anyhow!("--tick-ms requires a value"))?;
                    cli.tick_override =
                        Some(v.parse().map_err(|_| anyhow!("--tick-ms '{v}' is not a u64"))?);
                }
                "--check" => cli.check = true,
                "--once" => cli.once = true,
                "--fund" => cli.fund = true,
                "--seed-all" => cli.seed_all = true,
                "--daemon" => cli.daemon = true,
                "--cycles" => {
                    let v = it.next().ok_or_else(|| anyhow!("--cycles requires a value"))?;
                    cli.cycles =
                        Some(v.parse().map_err(|_| anyhow!("--cycles '{v}' is not a u64"))?);
                }
                "-h" | "--help" => {
                    print_help();
                    std::process::exit(0);
                }
                other => bail!("unknown argument '{other}' (try --help)"),
            }
        }
        Ok(cli)
    }
}

fn print_help() {
    println!(
        "gally_sim_bot — Gally Root Simulator (SIM-M2: lazy re-seed loop)\n\n\
         USAGE: gally_sim_bot [--pace real-world|accelerated] [--tick-ms N] [--check] [--once] [--fund]\n\n\
         --pace      Dual-State Engine profile (default: real-world)\n\
         --tick-ms   override the profile's default tick interval (ms)\n\
         --check     connect, read the faucet, report, then exit\n\
         --once      run one re-seed tick, then exit\n\
         --fund      seed a vouched FUNDING asset + run the user claim+contribute loop, then exit (SIM-M3)\n\
         --seed-all  full genesis: an asset in every lifecycle state + K validators + yield index (SIM-M3)\n\
         --daemon    activity daemon: continuous weighted-random protocol traffic (SIM-M4)\n\
         --cycles N  run exactly N ticks then exit (CI-style soak; default: run forever)\n\n\
         Config (env / config.toml): RPC_URL, FAUCET_URL, OPERATOR_KEY, GALLY_PACKAGE_ID,\n\
         FAUCET_PACKAGE_ID, MOCK_FAUCET_ID, USDC_TREASURY_CAP_ID, USER_COUNT, TICK_INTERVAL_MS,\n\
         RESEED_AMOUNT, GAS_THRESHOLD_MIST, USER_KEYS_PATH, PACE."
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli> {
        Cli::parse(args.iter().map(|s| s.to_string()))
    }

    #[test]
    fn test_cli_parse() {
        let c = parse(&["--pace", "accelerated", "--tick-ms", "500", "--once"]).unwrap();
        assert_eq!(c.pace, Some(Pace::Accelerated));
        assert_eq!(c.tick_override, Some(500));
        assert!(c.once && !c.check);

        let c = parse(&["--pace=real-world", "--check"]).unwrap();
        assert_eq!(c.pace, Some(Pace::RealWorld));
        assert!(c.check);

        let c = parse(&["--fund", "--pace", "accelerated"]).unwrap();
        assert!(c.fund && !c.check);
        assert_eq!(c.pace, Some(Pace::Accelerated));

        // empty -> all defaults (pace resolved later by config)
        let c = parse(&[]).unwrap();
        assert!(c.pace.is_none() && c.tick_override.is_none() && !c.check && !c.once);

        assert!(parse(&["--pace", "warp"]).is_err());
        assert!(parse(&["--bogus"]).is_err());
    }
}
