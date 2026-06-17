//! Governance feed handler (`protocol` module — `logic_flow.md §2.3`, `§10.3`).
//!
//! All five governance subtypes land in the single `governance_events` table; only the columns
//! relevant to each subtype are populated. The stored `event_type` is the struct name with the
//! `Event` suffix stripped (e.g. `ProtocolParamChanged`), matching the §6.4 normalized-name
//! convention and the `GET /governance?type=` filter.

use anyhow::Result;
use serde_json::Value;
use sqlx::PgPool;

use crate::db::queries::{self, GovernanceInsert};
use crate::ingestion::event_types::{
    EmergencyStopTriggeredEvent, ProtocolInitializedEvent, ProtocolParamChangedEvent,
    ProtocolResumedEvent, ProtocolTreasuryChangedEvent,
};
use crate::ingestion::handlers::EventMeta;

/// Route one governance event (identified by its `Event`-suffixed struct short name) into
/// `governance_events`. Returns `Ok(())` for any of the five subtypes; the caller has already
/// filtered to governance types via [`crate::ingestion::route_event`].
pub async fn handle_governance(
    pool: &PgPool,
    meta: &EventMeta,
    short_name: &str,
    payload: &Value,
) -> Result<()> {
    let event_type = short_name.strip_suffix("Event").unwrap_or(short_name);
    match short_name {
        "ProtocolInitializedEvent" => {
            let e: ProtocolInitializedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_governance_event(
                pool,
                meta,
                &GovernanceInsert {
                    event_type,
                    config_id: Some(&e.config_id),
                    admin: Some(&e.admin),
                    ..Default::default()
                },
            )
            .await
        }
        "ProtocolParamChangedEvent" => {
            let e: ProtocolParamChangedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_governance_event(
                pool,
                meta,
                &GovernanceInsert {
                    event_type,
                    param_name: Some(&e.name),
                    old_value: Some(e.old_value as i64),
                    new_value: Some(e.new_value as i64),
                    ..Default::default()
                },
            )
            .await
        }
        "ProtocolTreasuryChangedEvent" => {
            let e: ProtocolTreasuryChangedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_governance_event(
                pool,
                meta,
                &GovernanceInsert {
                    event_type,
                    old_treasury: Some(&e.old_treasury),
                    new_treasury: Some(&e.new_treasury),
                    ..Default::default()
                },
            )
            .await
        }
        "EmergencyStopTriggeredEvent" => {
            let e: EmergencyStopTriggeredEvent = serde_json::from_value(payload.clone())?;
            queries::insert_governance_event(
                pool,
                meta,
                &GovernanceInsert {
                    event_type,
                    config_id: Some(&e.config_id),
                    ..Default::default()
                },
            )
            .await
        }
        "ProtocolResumedEvent" => {
            let e: ProtocolResumedEvent = serde_json::from_value(payload.clone())?;
            queries::insert_governance_event(
                pool,
                meta,
                &GovernanceInsert {
                    event_type,
                    config_id: Some(&e.config_id),
                    ..Default::default()
                },
            )
            .await
        }
        other => anyhow::bail!("handle_governance called with non-governance type {other}"),
    }
}
