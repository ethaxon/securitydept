use std::collections::HashMap;

use axum::{
    Extension,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use tower_sessions::Session;

use crate::state::ServerState;

/// Middleware that requires a valid session.
pub async fn require_session(
    Extension(state): Extension<ServerState>,
    session: Session,
    request: Request,
    next: Next,
) -> Response {
    let handle = state.session_config.session_handle(session);

    match handle.require::<HashMap<String, Value>>().await {
        Ok(_) => next.run(request).await,
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({ "error": "Not authenticated" })),
        )
            .into_response(),
    }
}
