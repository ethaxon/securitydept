use axum::{
    Extension, Json,
    extract::Query,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use securitydept_core::{
    oidc::OidcCodeCallbackSearchParams,
    token_set_context::backend_oidc_mode::{
        BackendOidcModeAuthorizeQuery, BackendOidcModeMetadataRedemptionRequest,
        BackendOidcModeRefreshPayload, BackendOidcModeUserInfoRequest,
    },
    utils::observability::AuthFlowDiagnosisOutcome,
};

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::{ServerError, ServerResult},
    http_response::into_axum_response,
    state::ServerState,
};

/// GET /auth/token-set/backend-mode/login -- redirect to OIDC provider for
/// stateless token-set backend mode.
pub async fn login(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(query): Query<BackendOidcModeAuthorizeQuery>,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    state
        .backend_oidc_mode_auth_service()?
        .login(&external_base_url, &query)
        .await
        .map(into_axum_response)
        .map_err(ServerError::from)
}

/// GET /auth/token-set/backend-mode/callback -- handle OIDC code exchange for
/// stateless token-set backend mode (fragment redirect).
///
/// The post-auth redirect URI is resolved by the runtime's `Resolved` policy,
/// which validates the client-supplied `post_auth_redirect_uri` (stored during
/// login) against an allowlist configured in `config.rs`. Unknown values fall
/// back to the default redirect target (`/`).
pub async fn callback(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(search_params): Query<OidcCodeCallbackSearchParams>,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    let diagnosed = state
        .backend_oidc_mode_auth_service()?
        .callback_fragment_return_with_diagnosis(&external_base_url, search_params, None)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let response = result.map(into_axum_response).map_err(|error| {
        log_route_diagnosis_error(
            RouteDiagnosisContext {
                route: "/auth/token-set/backend-mode/callback",
                method: "GET",
                status: None,
            },
            &diagnosis,
            &error,
            "backend_oidc callback failed",
        );
        ServerError::from(error)
    })?;
    if matches!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Succeeded) {
        log_route_diagnosis(
            RouteDiagnosisContext {
                route: "/auth/token-set/backend-mode/callback",
                method: "GET",
                status: Some(response.status().as_u16()),
            },
            &diagnosis,
            "backend_oidc callback succeeded",
        );
    }
    Ok(response)
}

/// POST /auth/token-set/backend-mode/callback -- handle OIDC code exchange and
/// return token material + inline metadata as JSON body (for programmatic
/// flows).
pub async fn callback_body(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(search_params): Query<OidcCodeCallbackSearchParams>,
) -> ServerResult<Response> {
    let external_base_url = state.external_base_url(&headers)?;
    let diagnosed = state
        .backend_oidc_mode_auth_service()?
        .callback_body_return_with_diagnosis(&external_base_url, search_params)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let body = result.map_err(|error| {
        log_route_diagnosis_error(
            RouteDiagnosisContext {
                route: "/auth/token-set/backend-mode/callback",
                method: "POST",
                status: None,
            },
            &diagnosis,
            &error,
            "backend_oidc callback body failed",
        );
        ServerError::from(error)
    })?;
    if matches!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Succeeded) {
        log_route_diagnosis(
            RouteDiagnosisContext {
                route: "/auth/token-set/backend-mode/callback",
                method: "POST",
                status: Some(200),
            },
            &diagnosis,
            "backend_oidc callback body succeeded",
        );
    }
    Ok(Json(body).into_response())
}

/// POST /auth/token-set/backend-mode/refresh -- refresh token-set backend-mode
/// state and return token delta + inline metadata as JSON body.
pub async fn refresh(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<BackendOidcModeRefreshPayload>,
) -> ServerResult<Response> {
    let external_base_url = state.external_base_url(&headers)?;
    let diagnosed = state
        .backend_oidc_mode_auth_service()?
        .refresh_body_return_with_diagnosis(&payload, &external_base_url)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let body = result.map_err(|error| {
        log_route_diagnosis_error(
            RouteDiagnosisContext {
                route: "/auth/token-set/backend-mode/refresh",
                method: "POST",
                status: None,
            },
            &diagnosis,
            &error,
            "backend_oidc refresh failed",
        );
        ServerError::from(error)
    })?;
    if matches!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Succeeded) {
        log_route_diagnosis(
            RouteDiagnosisContext {
                route: "/auth/token-set/backend-mode/refresh",
                method: "POST",
                status: Some(200),
            },
            &diagnosis,
            "backend_oidc refresh succeeded",
        );
    }
    Ok(Json(body).into_response())
}

/// POST /auth/token-set/backend-mode/metadata/redeem -- redeem metadata by
/// one-time id.
pub async fn redeem_metadata(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<BackendOidcModeMetadataRedemptionRequest>,
) -> ServerResult<Response> {
    match state
        .backend_oidc_mode_auth_service()?
        .redeem_metadata(&payload)
        .await
        .map_err(ServerError::from)?
    {
        Some(metadata) => Ok(Json(metadata).into_response()),
        None => Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
    }
}

/// POST /auth/token-set/backend-mode/user-info -- exchange id_token +
/// access_token for normalized user info.
pub async fn user_info(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<BackendOidcModeUserInfoRequest>,
) -> ServerResult<Response> {
    let access_token =
        extract_bearer_token(&headers).ok_or_else(|| ServerError::InvalidConfig {
            message: "Missing or invalid Authorization: Bearer header".to_string(),
        })?;

    let response = state
        .backend_oidc_mode_auth_service()?
        .user_info(&payload, access_token)
        .await
        .map_err(ServerError::from)?;

    Ok(Json(response).into_response())
}

/// Extract bearer token from Authorization header.
fn extract_bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}
