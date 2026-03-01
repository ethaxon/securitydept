use axum::{
    Extension, Json,
    extract::Query,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use securitydept_core::{
    creds_manage::{CredsManageError, models::UserInfo},
    oidc::{
        OidcCodeCallbackSearchParams, OidcError,
        routes::{RefreshTokenPayload, refresh_token_route},
    },
};
use snafu::ResultExt;
use tracing::info;

use crate::{
    error::{RuntimeSnafu, ServerError, ServerResult},
    middleware::{SESSION_COOKIE_NAME, get_session_id},
    state::ServerState,
};

/// GET /auth/login -- redirect to OIDC provider, or create dev session when
/// OIDC is disabled.
pub async fn login(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
) -> Result<Response, ServerError> {
    if let Some(ref oidc) = state.oidc {
        let external_base_url = state
            .config
            .server
            .external_base_url
            .resolve_url(
                &headers,
                &state.config.server.host,
                state.config.server.port,
            )
            .map_err(|e| OidcError::RedirectUrl { source: e })?;
        let authorization_request = oidc
            .handle_code_authorize(&external_base_url, &state.pending_oauth)
            .await?;
        let authorization_url = authorization_request.authorization_url;
        return Ok(Redirect::temporary(authorization_url.as_str()).into_response());
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
    Ok((StatusCode::FOUND, headers).into_response())
}

/// GET /auth/callback
/// Handle OIDC code exchange.
pub async fn callback(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(search_params): Query<OidcCodeCallbackSearchParams>,
) -> Result<Response, ServerError> {
    let oidc = state.oidc_client()?;

    let external_base_url = state
        .config
        .server
        .external_base_url
        .resolve_url(
            &headers,
            &state.config.server.host,
            state.config.server.port,
        )
        .map_err(|e| OidcError::RedirectUrl { source: e })?;

    let code_callback_result = oidc
        .handle_code_callback(search_params, &external_base_url, &state.pending_oauth)
        .await?;
    let claims_check_result = code_callback_result.claims_check_result;

    // Create session
    let session_id = state
        .sessions
        .create(
            claims_check_result.display_name.clone(),
            claims_check_result.picture,
            claims_check_result.claims,
        )
        .await;

    info!(display_name = %claims_check_result.display_name, "User logged in");

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
pub async fn logout(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
) -> ServerResult<Response> {
    if let Some(session_id) = get_session_id(&headers) {
        state.sessions.remove(&session_id).await;
    }

    // Clear cookie
    let cookie = format!("{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0");
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert(
        "Set-Cookie",
        HeaderValue::from_str(&cookie)
            .boxed()
            .context(RuntimeSnafu)?,
    );

    Ok((
        StatusCode::OK,
        resp_headers,
        Json(serde_json::json!({"ok": true})),
    )
        .into_response())
}

pub async fn refresh_token(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<RefreshTokenPayload>,
) -> ServerResult<Response> {
    let oidc_client = state.oidc_client()?;
    let result = refresh_token_route(oidc_client, &headers, payload).await?;
    Ok(result.into_response())
}

/// GET /auth/me -- return current user info.
pub async fn me(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
) -> ServerResult<Json<UserInfo>> {
    let session_id = get_session_id(&headers).ok_or(CredsManageError::SessionNotFound)?;

    let session = state
        .sessions
        .get(&session_id)
        .await
        .ok_or(CredsManageError::SessionNotFound)?;

    Ok(Json(UserInfo {
        display_name: session.display_name,
        picture: session.picture,
        claims: session.claims,
    }))
}
