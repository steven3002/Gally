//! HTTP route handlers, one module per resource. BI-M1 implements only `health`; the rest
//! are placeholders filled in BI-M2..BI-M7.

pub mod health;

pub mod assets;
pub mod disputes;
pub mod governance;
pub mod portfolio;
pub mod proxy;
pub mod validators;
pub mod ws;
