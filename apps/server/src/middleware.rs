use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Extension;
use serde_json::json;

use crate::state::AppState;

pub const SESSION_COOKIE_NAME: &str = "securitydept_session";

/// Extract session ID from cookies.
pub fn get_session_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .map(|c| c.trim())
                .find(|c| c.starts_with(&format!("{SESSION_COOKIE_NAME}=")))
                .map(|c| c[SESSION_COOKIE_NAME.len() + 1..].to_string())
        })
}

/// Middleware that requires a valid session.
pub async fn require_session(
    Extension(state): Extension<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let session_id = get_session_id(request.headers());

    let session_id = match session_id {
        Some(id) => id,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                axum::Json(json!({ "error": "Not authenticated" })),
            )
                .into_response();
        }
    };

    let session = state.sessions.get(&session_id).await;
    match session {
        Some(_) => next.run(request).await,
        None => (
            StatusCode::UNAUTHORIZED,
            axum::Json(json!({ "error": "Session expired or invalid" })),
        )
            .into_response(),
    }
}
