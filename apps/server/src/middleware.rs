use std::collections::HashMap;

use axum::{Extension, extract::Request, middleware::Next, response::Response};
use securitydept_core::session_context::SessionContextSession;
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
    let handle = SessionContextSession::from_config(session, &state.config.session_context);

    let _ = handle.require::<HashMap<String, Value>>().await?;
    Ok(next.run(request).await)
}
