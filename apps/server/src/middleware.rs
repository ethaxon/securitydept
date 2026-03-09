use std::collections::HashMap;

use axum::{Extension, extract::Request, middleware::Next, response::Response};
use serde_json::Value;
use tower_sessions::Session;

use crate::{error::ServerResult, state::ServerState};

/// Middleware that requires a valid session.
pub async fn require_session(
    Extension(state): Extension<ServerState>,
    session: Session,
    request: Request,
    next: Next,
) -> ServerResult<Response> {
    let handle = state.session_config.session_handle(session);

    let _ = handle.require::<HashMap<String, Value>>().await?;
    Ok(next.run(request).await)
}
