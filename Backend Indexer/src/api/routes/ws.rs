//! WebSocket live-push routes (BI-M7): `/ws/assets/:id`, `/ws/portfolio/:addr`,
//! `/ws/disputes/:id` (`backend.md §5.2`, `logic_flow.md §5.2`).
//!
//! Each handler upgrades the connection, subscribes to its [`crate::ws::Hub`] channel, sends a
//! `{ "type": "connected", "channel", "id" }` handshake, then forwards every broadcast frame as a
//! text message until the client or the server goes away. **Connections are live-only** — events
//! emitted before the subscription are not replayed; the frontend backfills history over REST and
//! uses the socket for live deltas (`backend.md §5.2`).

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use tokio::sync::broadcast::error::RecvError;

use crate::api::limit::{self, WsPermit};
use crate::api::AppState;

/// The `503` returned when the process-wide WebSocket cap is full (the long-lived
/// socket is the cheapest DoS vector — see `api::limit`).
fn ws_capacity_full() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [("Retry-After", "5")],
        "websocket capacity reached\n",
    )
        .into_response()
}

/// `WS /ws/assets/:asset_id` — every new event row whose payload carries this `asset_id`.
pub async fn ws_asset(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(permit) = limit::ws_acquire() else {
        return ws_capacity_full();
    };
    let key = format!("asset:{asset_id}");
    let channel = format!("assets/{asset_id}");
    upgrade.on_upgrade(move |socket| run(socket, state, key, channel, permit))
}

/// `WS /ws/portfolio/:address` — every new `position_events`/`raise_progress` row for this actor.
pub async fn ws_portfolio(
    State(state): State<AppState>,
    Path(address): Path<String>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(permit) = limit::ws_acquire() else {
        return ws_capacity_full();
    };
    let key = format!("address:{address}");
    let channel = format!("portfolio/{address}");
    upgrade.on_upgrade(move |socket| run(socket, state, key, channel, permit))
}

/// `WS /ws/disputes/:dispute_id` — jury-vote pushes and the resolution update for one dispute.
pub async fn ws_dispute(
    State(state): State<AppState>,
    Path(dispute_id): Path<String>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(permit) = limit::ws_acquire() else {
        return ws_capacity_full();
    };
    let key = format!("dispute:{dispute_id}");
    let channel = format!("disputes/{dispute_id}");
    upgrade.on_upgrade(move |socket| run(socket, state, key, channel, permit))
}

/// Drive one upgraded socket: subscribe (before the handshake, so no live frame is missed), send
/// the `connected` frame, then pump broadcast frames out and discard client input until either
/// side closes. The active-connections gauge is incremented for the lifetime of the loop. The WS
/// cap [`WsPermit`] is held for the same lifetime — dropping it on return frees the slot.
async fn run(mut socket: WebSocket, state: AppState, key: String, channel: String, _permit: WsPermit) {
    // Subscribe FIRST: the receiver must exist before `connected` is sent so a client that waits
    // for the handshake before triggering work cannot race a publish into the gap.
    let mut rx = state.hub.subscribe(&key);
    let id = state.hub.next_connection_id();
    state.metrics.ws_connections.inc();

    let hello = json!({ "type": "connected", "channel": channel, "id": id.to_string() }).to_string();
    if socket.send(Message::Text(hello)).await.is_err() {
        state.metrics.ws_connections.dec();
        return;
    }

    loop {
        tokio::select! {
            received = rx.recv() => match received {
                Ok(frame) => {
                    if socket.send(Message::Text(frame)).await.is_err() {
                        break;
                    }
                }
                // Slow consumer dropped frames: skip the gap (REST is the source of history).
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            },
            // We are push-only: drain client frames so pings/closes are observed, ignore the rest.
            from_client = socket.recv() => match from_client {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
        }
    }

    state.metrics.ws_connections.dec();
}
