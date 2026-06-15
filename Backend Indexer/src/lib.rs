//! Gally Backend Indexer library crate.
//!
//! Module layout mirrors `logic_flow.md §8`. The binary (`main.rs`) wires these together;
//! the integration tests in `tests/integration/` drive them directly.

pub mod api;
pub mod config;
pub mod db;
pub mod ingestion;
pub mod sui_client;
