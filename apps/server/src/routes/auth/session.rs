use axum::{
    Extension, Json,
    extract::Query,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use securitydept_core::{
    creds_manage::models::UserInfo, oidc::OidcCodeCallbackSearchParams,
    session_context::SessionAuthServiceTrait,
};
use serde::Deserialize;
use tower_sessions::Session;
use tracing::{info, warn};

use crate::{
    error::{ServerError, ServerResult},
    http_response::into_axum_response,
    state::ServerState,
};

#[derive(Debug, Deserialize)]
pub struct SessionLoginQuery {
    #[serde(default)]
    pub post_auth_redirect_uri: Option<String>,
}

/// GET /auth/session/login -- redirect to OIDC provider, or create dev session
/// when OIDC is disabled.
pub async fn login(
    Extension(state): Extension<ServerState>,
    session: Session,
    headers: HeaderMap,
    Query(query): Query<SessionLoginQuery>,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    let diagnosed = state
        .session_auth_service()
        .login_diagnosed(
            session,
            &external_base_url,
            query.post_auth_redirect_uri.as_deref(),
        )
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    match &result {
        Ok(_) => info!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "Session login completed"
        ),
        Err(error) => warn!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            error = %error,
            "Session login failed"
        ),
    }
    result.map(into_axum_response).map_err(ServerError::from)
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
        .map(into_axum_response)
        .map_err(ServerError::from)
}

/// POST /auth/session/logout -- destroy session.
pub async fn logout(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Response> {
    let diagnosed = state.session_auth_service().logout_diagnosed(session).await;
    let (diagnosis, result) = diagnosed.into_parts();
    match &result {
        Ok(_) => info!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "Session logout completed"
        ),
        Err(error) => warn!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            error = %error,
            "Session logout failed"
        ),
    }
    let body = result.map_err(ServerError::from)?;

    Ok(Json(body).into_response())
}

/// GET /auth/session/user-info -- return current user info.
pub async fn user_info(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Json<UserInfo>> {
    let diagnosed = state
        .session_auth_service()
        .user_info_diagnosed(session)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    match &result {
        Ok(_) => info!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "Session user-info completed"
        ),
        Err(error) => warn!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            error = %error,
            "Session user-info failed"
        ),
    }
    let context = result.map_err(ServerError::from)?;

    Ok(Json(UserInfo {
        display_name: context.principal.display_name,
        picture: context.principal.picture,
        claims: context.principal.claims,
    }))
}
