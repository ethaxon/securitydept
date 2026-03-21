use axum::{Extension, Json, extract::Query, http::HeaderMap, response::Response};
use securitydept_core::{
    auth_runtime::SessionAuthServiceTrait, creds_manage::models::UserInfo,
    oidc::OidcCodeCallbackSearchParams,
};
use tower_sessions::Session;

use crate::{
    error::{ServerError, ServerResult},
    state::ServerState,
};

/// GET /auth/session/login -- redirect to OIDC provider, or create dev session
/// when OIDC is disabled.
pub async fn login(
    Extension(state): Extension<ServerState>,
    session: Session,
    headers: HeaderMap,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    state
        .session_auth_service()
        .login(session, &external_base_url)
        .await
        .map_err(ServerError::from)
}

/// GET /auth/session/callback -- handle OIDC code exchange.
pub async fn callback(
    Extension(state): Extension<ServerState>,
    session: Session,
    headers: HeaderMap,
    Query(search_params): Query<OidcCodeCallbackSearchParams>,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    state
        .session_auth_service()
        .callback(session, &external_base_url, search_params)
        .await
        .map_err(ServerError::from)
}

/// POST /auth/session/logout -- destroy session.
pub async fn logout(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Response> {
    state
        .session_auth_service()
        .logout(session)
        .await
        .map_err(ServerError::from)
}

/// GET /auth/session/me -- return current user info.
pub async fn me(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Json<UserInfo>> {
    let context = state
        .session_auth_service()
        .me(session)
        .await
        .map_err(ServerError::from)?
        .0;

    Ok(Json(UserInfo {
        display_name: context.principal.display_name,
        picture: context.principal.picture,
        claims: context.principal.claims,
    }))
}
