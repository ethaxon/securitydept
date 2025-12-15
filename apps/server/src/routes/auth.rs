use axum::extract::Query;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::{Extension, Json};
use serde::Deserialize;
use tracing::info;

use securitydept_core::claims_engine;
use securitydept_core::models::UserInfo;

use crate::error::AppError;
use crate::middleware::{get_session_id, SESSION_COOKIE_NAME};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct CallbackParams {
    pub code: String,
    #[allow(dead_code)]
    pub state: Option<String>,
}

/// GET /auth/login -- redirect to OIDC provider.
pub async fn login(Extension(state): Extension<AppState>) -> Response {
    let (url, _csrf, _nonce) = state.oidc.authorize_url();
    // TODO: persist csrf + nonce in session for validation
    Redirect::temporary(&url).into_response()
}

/// GET /auth/callback -- handle OIDC code exchange.
pub async fn callback(
    Extension(state): Extension<AppState>,
    Query(params): Query<CallbackParams>,
) -> Result<Response, AppError> {
    // Exchange the auth code for claims
    let nonce = openidconnect::Nonce::new("placeholder".to_string());
    let claims = state.oidc.exchange_code(&params.code, &nonce).await?;

    info!("OIDC callback received claims");

    // Run claims check if configured
    let display_name = if let Some(ref script) = state.claims_script {
        let result = claims_engine::run_claims_check(script, &claims)?;
        result
            .display_name
            .unwrap_or_else(|| "Unknown".to_string())
    } else {
        // Default: extract displayName from common claim fields
        claims
            .get("preferred_username")
            .or_else(|| claims.get("name"))
            .or_else(|| claims.get("sub"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string()
    };

    // Create session
    let session_id = state
        .sessions
        .create(display_name.clone(), claims)
        .await;

    info!(display_name = %display_name, "User logged in");

    // Set session cookie and redirect to app root
    let cookie = format!(
        "{SESSION_COOKIE_NAME}={session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"
    );

    let mut headers = HeaderMap::new();
    headers.insert(
        "Set-Cookie",
        HeaderValue::from_str(&cookie).unwrap(),
    );
    headers.insert("Location", HeaderValue::from_static("/"));

    Ok((StatusCode::FOUND, headers).into_response())
}

/// POST /auth/logout -- destroy session.
pub async fn logout(
    Extension(state): Extension<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Some(session_id) = get_session_id(&headers) {
        state.sessions.remove(&session_id).await;
    }

    // Clear cookie
    let cookie = format!("{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0");
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert(
        "Set-Cookie",
        HeaderValue::from_str(&cookie).unwrap(),
    );

    (StatusCode::OK, resp_headers, Json(serde_json::json!({"ok": true}))).into_response()
}

/// GET /auth/me -- return current user info.
pub async fn me(
    Extension(state): Extension<AppState>,
    headers: HeaderMap,
) -> Result<Json<UserInfo>, AppError> {
    let session_id = get_session_id(&headers)
        .ok_or(securitydept_core::error::Error::SessionNotFound)?;

    let session = state
        .sessions
        .get(&session_id)
        .await
        .ok_or(securitydept_core::error::Error::SessionNotFound)?;

    Ok(Json(UserInfo {
        display_name: session.display_name,
        claims: session.claims,
    }))
}
