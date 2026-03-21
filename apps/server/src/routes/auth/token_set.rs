use axum::{Extension, Json, extract::Query, http::HeaderMap, response::Response};
use securitydept_core::{
    oidc::OidcCodeCallbackSearchParams,
    token_set_context::{MetadataRedemptionRequest, TokenRefreshPayload, TokenSetAuthorizeQuery},
};

use crate::{
    error::{ServerError, ServerResult},
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
        .token_set_auth_service()?
        .login(&external_base_url, &query)
        .await
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
        .token_set_auth_service()?
        .callback(&external_base_url, search_params)
        .await
        .map_err(ServerError::from)
}

/// POST /auth/token-set/refresh -- refresh token-set state.
pub async fn refresh(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<TokenRefreshPayload>,
) -> ServerResult<Response> {
    state
        .token_set_auth_service()?
        .refresh(&payload)
        .await
        .map_err(ServerError::from)
}

/// POST /auth/token-set/metadata/redeem -- redeem metadata by one-time id.
pub async fn redeem_metadata(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<MetadataRedemptionRequest>,
) -> ServerResult<Response> {
    state
        .token_set_auth_service()?
        .redeem_metadata(&payload)
        .await
        .map_err(ServerError::from)
}
