//! SIM-M6 — deterministic project catalog + Move-literal builders for the trustless on-chain
//! metadata `gally_core` M8 added (Live-Data Parity, `data_parity_plan.md` §7).
//!
//! Everything here is **pure and deterministic** (R5): a fresh-node soak always produces the same
//! believable world, and a re-run is a no-op (SI-5). The module owns three things:
//!   1. a curated [`Project`] catalog covering all six [CORE] categories (§11.6 / LI-D4), some
//!      flagged `term` (driven via `create_term_asset`), each with a 2–3 tranche count;
//!   2. the **Move-call argument builders** that wire the new metadata params into a PTB in the
//!      exact order of `asset::create_asset` / `create_term_asset` (read from the shipped source,
//!      guard_rails R2) — never hand-written at the call sites;
//!   3. the **mock-Walrus** blob doc + real **sha256** (LI-Q3): the on-chain `metadata_blob`'s
//!      `sha256` equals `sha256(blob_doc)`, and [`crate::walrus`] writes the `blob_id → doc` map so
//!      the frontend resolves + verifies it in sim mode.
//!
//! Caps mirror `asset.move` (`MAX_NAME_BYTES=96`, `MAX_TICKER_BYTES=12`, etc.); the catalog strings
//! are well under them. `category` is always `< 6` (the §11.6 enum), so the on-chain
//! `EInvalidCategory` guard is never tripped by the sim.

use sha2::{Digest, Sha256};

/// One curated project. All fields are short ASCII (well under the [CORE] byte caps).
#[derive(Debug, Clone, Copy)]
pub struct Project {
    pub name: &'static str,
    pub ticker: &'static str,
    /// LI-D4 enum: 0 Housing · 1 Machinery · 2 Trade Finance · 3 Agriculture · 4 Energy · 5 Infrastructure.
    pub category: u8,
    pub location: &'static str,
    pub entity_name: &'static str,
    pub blurb: &'static str,
    /// Drive via `create_term_asset` (fixed return target) rather than open-ended revenue share.
    pub term: bool,
    /// Number of milestone tranches (2 or 3) the funding goal is split across.
    pub tranches: u8,
}

/// The catalog. Ordered so `project(0..6)` covers **every** category exactly once (Pass Criteria 2:
/// "≥1 asset per category"); the term assets (Trade Finance + Energy) give the term→CLOSED-reason-1
/// path real coverage. Stable — appending is fine, reordering changes the deterministic world.
pub const PROJECTS: &[Project] = &[
    Project {
        name: "Lekki Coastal Homes",
        ticker: "LCH",
        category: 0, // Housing
        location: "Lagos, NG",
        entity_name: "Lekki Estates Ltd",
        blurb: "A 120-unit affordable-housing estate on the Lekki corridor; investor returns from rent and resale.",
        term: false,
        tranches: 3,
    },
    Project {
        name: "Kano CNC Workshop",
        ticker: "KCNC",
        category: 1, // Machinery
        location: "Kano, NG",
        entity_name: "Sahel Fabrication Co",
        blurb: "Import and commission three CNC machining centres for a regional metal-fabrication hub.",
        term: false,
        tranches: 2,
    },
    Project {
        name: "Apapa Trade Receivables",
        ticker: "ATR",
        category: 2, // Trade Finance
        location: "Apapa, Lagos, NG",
        entity_name: "Harbour Trade Finance",
        blurb: "90-day import-receivables facility for vetted FMCG distributors clearing through Apapa port.",
        term: true,
        tranches: 2,
    },
    Project {
        name: "Jos Greenhouse Cluster",
        ticker: "JGC",
        category: 3, // Agriculture
        location: "Jos, Plateau, NG",
        entity_name: "Highland Agritech",
        blurb: "Climate-controlled greenhouses for off-season tomato and pepper production on the Jos plateau.",
        term: false,
        tranches: 3,
    },
    Project {
        name: "Sokoto Solar Microgrid",
        ticker: "SSM",
        category: 4, // Energy
        location: "Sokoto, NG",
        entity_name: "BrightPower Renewables",
        blurb: "A 2 MW solar microgrid with battery storage powering a peri-urban cluster; PPA-backed returns.",
        term: true,
        tranches: 3,
    },
    Project {
        name: "Onitsha Cold-Chain Depot",
        ticker: "OCD",
        category: 5, // Infrastructure
        location: "Onitsha, Anambra, NG",
        entity_name: "Niger Logistics Infra",
        blurb: "A refrigerated cross-dock depot serving south-eastern agri and pharma distribution.",
        term: false,
        tranches: 2,
    },
    Project {
        name: "Abuja Modular Flats",
        ticker: "AMF",
        category: 0, // Housing (a second housing project for variety)
        location: "Abuja, FCT, NG",
        entity_name: "Capital Modular Homes",
        blurb: "Prefabricated mid-rise flats for the Abuja civil-servant rental market.",
        term: false,
        tranches: 2,
    },
];

/// Deterministic catalog entry for a 0-based asset ordinal (wraps the catalog).
pub fn project(ordinal: usize) -> &'static Project {
    &PROJECTS[ordinal % PROJECTS.len()]
}

/// The catalog ordinal of the first term-financing project (`p.term`). Drives the lifecycle's
/// term→CLOSED-reason-1 asset off the catalog flag rather than a hardcoded index.
pub fn first_term_ordinal() -> usize {
    PROJECTS.iter().position(|p| p.term).unwrap_or(0)
}

/// Self-asserted validator display names (LI-D6), assigned deterministically by pool ordinal.
pub const VALIDATOR_NAMES: &[&str] = &[
    "Sentinel Legal Attestation",
    "Anchor Diligence Partners",
    "Meridian Compliance Co",
    "Keystone Verification",
];

/// Validator name for a 0-based pool ordinal (wraps). Always within `MAX_NAME_BYTES` (96).
pub fn validator_name(ordinal: usize) -> &'static str {
    VALIDATOR_NAMES[ordinal % VALIDATOR_NAMES.len()]
}

/// Short challenger reasons for daemon-opened disputes (LI-D7), within `MAX_REASON_BYTES` (256).
pub const DISPUTE_REASONS: &[&str] = &[
    "Milestone proof appears forged; site photos predate the claimed work.",
    "Vouched legal docs do not match the registered land title.",
    "Released tranche funds were not applied to the stated milestone.",
];

/// Dispute reason for a 0-based ordinal (wraps).
pub fn dispute_reason(ordinal: usize) -> &'static str {
    DISPUTE_REASONS[ordinal % DISPUTE_REASONS.len()]
}

/// A `vector<u8>` Move-call literal for raw bytes, e.g. `vector[72u8,105u8]` (`vector[]` if empty).
pub fn vec_u8_literal(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "vector[]".to_string();
    }
    let inner: Vec<String> = bytes.iter().map(|b| format!("{b}u8")).collect();
    format!("vector[{}]", inner.join(","))
}

/// `vector<u8>` literal for a UTF-8 string (the on-chain text fields are `vector<u8>`, LI-Q2).
pub fn str_literal(s: &str) -> String {
    vec_u8_literal(s.as_bytes())
}

/// Deterministic mock-Walrus blob id for a project (LI-Q3): `b"walrus:" + ticker`. Stable, unique
/// per project, and what [`crate::walrus`] keys the resolvable doc map on.
pub fn blob_id_bytes(p: &Project) -> Vec<u8> {
    format!("walrus:{}", p.ticker).into_bytes()
}

/// The canonical mock-Walrus document for a project — the rich content (LI-D3) the frontend fetches
/// by `blob_id` and sha256-verifies. Deterministic JSON (stable key order) so the sha256 is stable.
pub fn blob_doc(p: &Project) -> String {
    // Hand-built so key order / spacing is fixed (serde_json::json! would also be stable here, but
    // an explicit template makes the sha256 obviously reproducible).
    format!(
        "{{\"name\":\"{}\",\"ticker\":\"{}\",\"category\":{},\"location\":\"{}\",\"entity_name\":\"{}\",\"blurb\":\"{}\"}}",
        p.name, p.ticker, p.category, p.location, p.entity_name, p.blurb
    )
}

/// `sha256(blob_doc)` — the on-chain `metadata_sha256`. The frontend recomputes this over the
/// fetched doc to verify integrity (Pass Criteria 3).
pub fn blob_sha256(p: &Project) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(blob_doc(p).as_bytes());
    h.finalize().into()
}

/// The seven metadata Move-call args, in the exact `create_asset` order between `revenue_split_bps`
/// and `collateral` (guard_rails R2): `name, ticker, category, location, entity_name,
/// metadata_blob_id, metadata_sha256`.
pub fn metadata_args(p: &Project) -> Vec<String> {
    vec![
        str_literal(p.name),
        str_literal(p.ticker),
        format!("{}u8", p.category),
        str_literal(p.location),
        str_literal(p.entity_name),
        vec_u8_literal(&blob_id_bytes(p)),
        vec_u8_literal(&blob_sha256(p)),
    ]
}

/// Build a valid multi-tranche schedule for `funding_goal` split across `p.tranches` milestones.
/// Returns the three parallel Move-call literals `(amounts, descriptions, deadlines_ms)` honoring
/// the [CORE] §7 invariants: `Σ amounts == goal`, every amount `> 0`, deadlines strictly ascending
/// and all `> funding_deadline_ms`. Deadlines are `funding_deadline_ms + (i+1)*step_ms` (the caller
/// chooses `step_ms` short for `--pace accelerated`, R9, or far-future for the success pipeline).
pub fn tranche_schedule_literals(
    p: &Project,
    funding_goal: u64,
    funding_deadline_ms: u64,
    step_ms: u64,
) -> (String, String, String) {
    let n = p.tranches.max(1) as u64;
    let base = funding_goal / n;
    let mut amounts = Vec::new();
    let mut descs = Vec::new();
    let mut deadlines = Vec::new();
    for i in 0..n {
        // Last tranche absorbs the remainder so Σ == goal exactly.
        let amount = if i == n - 1 { funding_goal - base * (n - 1) } else { base };
        amounts.push(format!("{amount}u64"));
        descs.push(str_literal(&tranche_description(p, i as u8, n as u8)));
        deadlines.push(format!("{}u64", funding_deadline_ms + (i + 1) * step_ms));
    }
    (
        format!("vector[{}]", amounts.join(",")),
        format!("vector[{}]", descs.join(",")),
        format!("vector[{}]", deadlines.join(",")),
    )
}

/// A believable milestone label for tranche `i` of `n` (used in the schedule + the explorer).
fn tranche_description(p: &Project, i: u8, n: u8) -> String {
    // Category-flavoured phase names; falls back to a generic "Phase k/n".
    let phase = match (p.category, i) {
        (0, 0) => "Site acquisition & permits",
        (0, 1) => "Structural build-out",
        (0, _) => "Fit-out & handover",
        (3, 0) => "Land prep & irrigation",
        (3, 1) => "Planting cycle",
        (3, _) => "Harvest & distribution",
        (4, 0) => "Procurement & civils",
        (4, 1) => "Panel & inverter install",
        (4, _) => "Grid connection & commissioning",
        (_, 0) => "Mobilisation",
        (_, 1) => "Delivery & install",
        (_, _) => "Commissioning",
    };
    format!("Phase {}/{}: {}", i + 1, n, phase)
}

/// `return_target` for a term asset: a margin above the goal (≥ goal is the [CORE] invariant). 15%.
pub fn term_return_target(funding_goal: u64) -> u64 {
    funding_goal + funding_goal * 15 / 100
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_catalog_deterministic() {
        // Every category 0..=5 is represented (Pass Criteria 2), and strings stay under the
        // asset.move byte caps (name ≤ 96, ticker ≤ 12, location ≤ 96, entity_name ≤ 96).
        let mut seen = [false; 6];
        for p in PROJECTS {
            assert!(p.category < 6, "category {} out of the LI-D4 enum range", p.category);
            seen[p.category as usize] = true;
            assert!(p.name.len() <= 96 && !p.name.is_empty());
            assert!(p.ticker.len() <= 12 && !p.ticker.is_empty());
            assert!(p.location.len() <= 96);
            assert!(p.entity_name.len() <= 96);
            assert!(p.tranches >= 2 && p.tranches <= 3, "2–3 tranches per project");
        }
        assert!(seen.iter().all(|&s| s), "catalog covers all six categories");

        // Deterministic: same ordinal → same project; wraps past the end.
        assert_eq!(project(0).ticker, PROJECTS[0].ticker);
        assert_eq!(project(PROJECTS.len()).ticker, PROJECTS[0].ticker);
        // sha256 is stable + non-empty for the same project.
        assert_eq!(blob_sha256(project(0)), blob_sha256(project(0)));
        assert_eq!(vec_u8_literal(&blob_sha256(project(0))).matches("u8").count(), 32);
        // At least one term asset exists (drives the create_term_asset → CLOSED reason 1 path).
        assert!(PROJECTS.iter().any(|p| p.term), "catalog has ≥1 term-financing project");
    }

    #[test]
    fn test_create_asset_args_include_metadata() {
        // The metadata block is exactly the 7 fields, in create_asset order (guard_rails R2).
        let p = project(0);
        let args = metadata_args(p);
        assert_eq!(args.len(), 7, "name,ticker,category,location,entity_name,blob_id,sha256");
        assert_eq!(args[0], str_literal(p.name));
        assert_eq!(args[2], format!("{}u8", p.category), "category is a u8 literal");
        assert!(args[5].starts_with("vector["), "blob_id is a vector<u8> literal");
        assert!(args[6].matches("u8").count() == 32, "sha256 is 32 bytes");
        // Text literals are byte vectors, not quoted strings.
        assert!(args[0].starts_with("vector[") && args[0].contains("u8"));
    }

    #[test]
    fn test_multitranche_schedule_built() {
        let p = project(0); // 3 tranches
        let goal = 100_000_000_000u64;
        let fd = 1_000_000u64;
        let step = 3_600_000u64;
        let (amounts, descs, deadlines) = tranche_schedule_literals(p, goal, fd, step);

        // Three parallel entries (2–3 tranches, here 3).
        assert_eq!(amounts.matches("u64").count(), 3);
        assert_eq!(deadlines.matches("u64").count(), 3);
        assert_eq!(descs.matches("vector[").count(), 4, "outer vec + 3 inner byte-vecs");

        // Σ amounts == goal (the §7 "every dollar in one tranche" invariant). Parse the literal.
        let sum: u64 = amounts
            .trim_start_matches("vector[")
            .trim_end_matches(']')
            .split(',')
            .map(|t| t.trim_end_matches("u64").parse::<u64>().unwrap())
            .sum();
        assert_eq!(sum, goal, "tranche amounts sum to the funding goal");

        // Deadlines strictly ascending and all > funding_deadline_ms.
        let ds: Vec<u64> = deadlines
            .trim_start_matches("vector[")
            .trim_end_matches(']')
            .split(',')
            .map(|t| t.trim_end_matches("u64").parse::<u64>().unwrap())
            .collect();
        assert!(ds[0] > fd);
        assert!(ds.windows(2).all(|w| w[1] > w[0]), "deadlines strictly ascending");
    }

    #[test]
    fn test_term_asset_path_selected() {
        // The seeder/daemon pick term assets straight from the catalog flag, so "a term asset is
        // driven" reduces to "the catalog yields a term project" — and the return target clears the
        // [CORE] `return_target >= funding_goal` guard.
        let term = PROJECTS.iter().find(|p| p.term).expect("≥1 term project");
        assert_eq!(term.category, 2, "first term project is Trade Finance");
        let goal = 80_000_000_000u64;
        assert!(term_return_target(goal) >= goal, "term return target ≥ goal (EReturnTargetNotMet)");
    }
}
