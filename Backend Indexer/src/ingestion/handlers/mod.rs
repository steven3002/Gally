//! Typed event handlers, one module per feed family. Wired into [`crate::ingestion::dispatch`]
//! in BI-M2..BI-M4; empty placeholders in BI-M1.

pub mod asset;
pub mod dispute;
pub mod governance;
pub mod position;
pub mod tranche;
pub mod validator;
pub mod yield_index;
