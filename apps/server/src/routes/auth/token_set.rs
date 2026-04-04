use axum::{
    Extension, Json,
    extract::Query,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use securitydept_core::{
    oidc::OidcCodeCallbackSearchParams,
    token_set_context::backend_oidc_mediated_mode::{
        MetadataRedemptionRequest, TokenRefreshPayload, TokenSetAuthorizeQuery,
    },
};

use crate::{
    error::{ServerError, ServerResult},
    http_response::into_axum_response,
    state::ServerState,
};

/// GET /auth/token-set/login -- redirect to OIDC provider for stateless
/// token-set mode.
pub async fn login(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(query): Query<TokenSetAuthorizeQuery>,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    state
        .mediated_auth_service()?
        .login(&external_base_url, &query)
        .await
        .map(into_axum_response)
        .map_err(ServerError::from)
}

/// GET /auth/token-set/callback -- handle OIDC code exchange for stateless
/// token-set mode.
pub async fn callback(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(search_params): Query<OidcCodeCallbackSearchParams>,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    state
        .mediated_auth_service()?
        .callback(&external_base_url, search_params)
        .await
        .map(into_axum_response)
        .map_err(ServerError::from)
}

/// POST /auth/token-set/refresh -- refresh token-set state.
pub async fn refresh(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<TokenRefreshPayload>,
) -> ServerResult<Response> {
    state
        .mediated_auth_service()?
        .refresh(&payload)
        .await
        .map(into_axum_response)
        .map_err(ServerError::from)
}

/// POST /auth/token-set/metadata/redeem -- redeem metadata by one-time id.
pub async fn redeem_metadata(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<MetadataRedemptionRequest>,
) -> ServerResult<Response> {
    match state
        .mediated_auth_service()?
        .redeem_metadata(&payload)
        .await
        .map_err(ServerError::from)?
    {
        Some(metadata) => Ok(Json(metadata).into_response()),
        None => Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
    }
}
