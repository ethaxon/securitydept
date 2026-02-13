use axum::extract::Query;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::{Extension, Json};
use serde::Deserialize;
use tracing::info;

use securitydept_core::base_url;
use securitydept_core::claims_engine;
use securitydept_core::models::UserInfo;

use crate::error::AppError;
use crate::middleware::{SESSION_COOKIE_NAME, get_session_id};
use crate::state::AppState;

/// Resolve the external base URL for the current request.
fn resolve_base_url(state: &AppState, headers: &HeaderMap) -> String {
    base_url::resolve_base_url(
        &state.external_base_url,
        headers,
        &state.config.server.host,
        state.config.server.port,
    )
}

#[derive(Deserialize)]
pub struct CallbackParams {
    pub code: String,
    /// OAuth state (CSRF token); required for callback validation.
    pub state: Option<String>,
}

/// GET /auth/login -- redirect to OIDC provider, or create dev session when OIDC is disabled.
pub async fn login(Extension(state): Extension<AppState>, headers: HeaderMap) -> Response {
    if let Some(ref oidc) = state.oidc {
        let base_url = resolve_base_url(&state, &headers);
        let (url, csrf, nonce, pkce_verifier) = match oidc.authorize_url(&base_url) {
            Ok(result) => result,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Failed to build auth URL: {e}") })),
                )
                    .into_response();
            }
        };
        state
            .pending_oauth
            .insert(
                csrf.secret().to_string(),
                nonce.secret().to_string(),
                pkce_verifier,
            )
            .await;
        return Redirect::temporary(&url).into_response();
    }

    // OIDC disabled: create a dev session for local debugging
    let session_id = state
        .sessions
        .create(
            "dev".to_string(),
            None,
            serde_json::json!({ "oidc_enabled": false }),
        )
        .await;
    let cookie = format!(
        "{SESSION_COOKIE_NAME}={session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"
    );
    let mut headers = HeaderMap::new();
    headers.insert("Set-Cookie", HeaderValue::from_str(&cookie).unwrap());
    headers.insert("Location", HeaderValue::from_static("/"));
    (StatusCode::FOUND, headers).into_response()
}

/// GET /auth/callback -- handle OIDC code exchange.
pub async fn callback(
    Extension(state): Extension<AppState>,
    headers: HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Result<Response, AppError> {
    let oidc =
        state
            .oidc
            .as_ref()
            .ok_or_else(|| securitydept_core::error::Error::InvalidConfig {
                message: "OIDC is disabled".to_string(),
            })?;

    let state_param =
        params
            .state
            .as_deref()
            .ok_or_else(|| securitydept_core::error::Error::OidcClaims {
                message: "Missing state parameter in callback (required for CSRF validation)"
                    .to_string(),
            })?;

    let pending = state.pending_oauth.take(state_param).await.ok_or_else(|| {
        securitydept_core::error::Error::OidcClaims {
            message: "Invalid or expired state (reuse or unknown); try logging in again"
                .to_string(),
        }
    })?;

    let base_url = resolve_base_url(&state, &headers);
    let nonce = openidconnect::Nonce::new(pending.nonce);
    let claims = oidc
        .exchange_code(
            &params.code,
            &nonce,
            &base_url,
            pending.code_verifier.as_deref(),
        )
        .await?;

    info!("OIDC callback received claims");

    // Run claims check if configured
    let (display_name, picture) = if let Some(ref script) = state.claims_script {
        let result = claims_engine::run_claims_check(script, &claims)?;
        (
            result.display_name.unwrap_or_else(|| "Unknown".to_string()),
            result.picture,
        )
    } else {
        // Default: extract displayName from common claim fields
        let name = claims
            .get("preferred_username")
            .or_else(|| claims.get("nickname"))
            .or_else(|| claims.get("sub"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let picture = claims
            .get("picture")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());
        (name, picture)
    };

    // Create session
    let session_id = state
        .sessions
        .create(display_name.clone(), picture, claims)
        .await;

    info!(display_name = %display_name, "User logged in");

    // Set session cookie and redirect to app root
    let cookie = format!(
        "{SESSION_COOKIE_NAME}={session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"
    );

    let mut headers = HeaderMap::new();
    headers.insert("Set-Cookie", HeaderValue::from_str(&cookie).unwrap());
    headers.insert("Location", HeaderValue::from_static("/"));

    Ok((StatusCode::FOUND, headers).into_response())
}

/// POST /auth/logout -- destroy session.
pub async fn logout(Extension(state): Extension<AppState>, headers: HeaderMap) -> Response {
    if let Some(session_id) = get_session_id(&headers) {
        state.sessions.remove(&session_id).await;
    }

    // Clear cookie
    let cookie = format!("{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0");
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert("Set-Cookie", HeaderValue::from_str(&cookie).unwrap());

    (
        StatusCode::OK,
        resp_headers,
        Json(serde_json::json!({"ok": true})),
    )
        .into_response()
}

/// GET /auth/me -- return current user info.
pub async fn me(
    Extension(state): Extension<AppState>,
    headers: HeaderMap,
) -> Result<Json<UserInfo>, AppError> {
    let session_id =
        get_session_id(&headers).ok_or(securitydept_core::error::Error::SessionNotFound)?;

    let session = state
        .sessions
        .get(&session_id)
        .await
        .ok_or(securitydept_core::error::Error::SessionNotFound)?;

    Ok(Json(UserInfo {
        display_name: session.display_name,
        picture: session.picture,
        claims: session.claims,
    }))
}
