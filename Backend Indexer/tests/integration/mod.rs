//! Integration test crate. One submodule per area: ingestion + DB + handlers
//! (`test_ingestion`) and the HTTP API surface (`test_api`, added in BI-M2).

mod test_api;
mod test_ingestion;
