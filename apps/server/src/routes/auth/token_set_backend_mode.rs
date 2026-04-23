use axum::{
    Extension, Json,
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use securitydept_core::{
    oidc::OidcCodeCallbackSearchParams,
    token_set_context::backend_oidc_mode::{
        BackendOidcModeAuthorizeQuery, BackendOidcModeMetadataRedemptionRequest,
        BackendOidcModeRefreshPayload, BackendOidcModeUserInfoRequest,
    },
    utils::{
        error::{ErrorPresentation, UserRecovery},
        http::ToHttpStatus,
        observability::{AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowOperation},
    },
};

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::{ServerError, ServerResult},
    http_response::into_axum_response,
    state::ServerState,
};

fn backend_oidc_missing_access_token_diagnosis() -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::rejected(AuthFlowOperation::OIDC_USER_INFO)
        .field(AuthFlowDiagnosisField::MODE, "backend_oidc")
        .field(AuthFlowDiagnosisField::ACCESS_TOKEN_PRESENT, false)
        .field(AuthFlowDiagnosisField::REASON, "missing_access_token")
}

fn backend_oidc_missing_access_token_error() -> ServerError {
    ServerError::route_presentation(
        StatusCode::UNAUTHORIZED,
        ErrorPresentation::new(
            "backend_oidc_mode.bearer_token_required",
            "A bearer access token is required for this endpoint.",
            UserRecovery::Reauthenticate,
        ),
        "Missing or invalid Authorization: Bearer header",
    )
}

fn backend_oidc_metadata_not_found_response() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

/// GET /auth/token-set/backend-mode/login -- redirect to OIDC provider for
/// stateless token-set backend mode.
pub async fn login(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(query): Query<BackendOidcModeAuthorizeQuery>,
) -> Result<Response, ServerError> {
    let external_base_url = state.external_base_url(&headers)?;
    let diagnosed = state
        .backend_oidc_mode_auth_service()?
        .login_with_diagnosis(&external_base_url, &query)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/auth/token-set/backend-mode/login",
        method: "GET",
        status: result
            .as_ref()
            .ok()
            .map(|response| response.status.as_u16())
            .or_else(|| {
                result
                    .as_ref()
                    .err()
                    .map(|error| error.to_http_status().as_u16())
            }),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "backend_oidc login completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "backend_oidc login failed")
        }
    }

    result.map(into_axum_response).map_err(ServerError::from)
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
    let context = RouteDiagnosisContext {
        route: "/auth/token-set/backend-mode/callback",
        method: "GET",
        status: result
            .as_ref()
            .ok()
            .map(|response| response.status.as_u16())
            .or_else(|| {
                result
                    .as_ref()
                    .err()
                    .map(|error| error.to_http_status().as_u16())
            }),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "backend_oidc callback completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "backend_oidc callback failed")
        }
    }

    result.map(into_axum_response).map_err(ServerError::from)
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
    let context = RouteDiagnosisContext {
        route: "/auth/token-set/backend-mode/callback",
        method: "POST",
        status: result.as_ref().ok().map(|_| 200).or_else(|| {
            result
                .as_ref()
                .err()
                .map(|error| error.to_http_status().as_u16())
        }),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "backend_oidc callback body completed"),
        Err(error) => log_route_diagnosis_error(
            context,
            &diagnosis,
            error,
            "backend_oidc callback body failed",
        ),
    }
    let body = result.map_err(ServerError::from)?;
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
    let context = RouteDiagnosisContext {
        route: "/auth/token-set/backend-mode/refresh",
        method: "POST",
        status: result.as_ref().ok().map(|_| 200).or_else(|| {
            result
                .as_ref()
                .err()
                .map(|error| error.to_http_status().as_u16())
        }),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "backend_oidc refresh completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "backend_oidc refresh failed")
        }
    }
    let body = result.map_err(ServerError::from)?;
    Ok(Json(body).into_response())
}

/// POST /auth/token-set/backend-mode/metadata/redeem -- redeem metadata by
/// one-time id.
pub async fn redeem_metadata(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<BackendOidcModeMetadataRedemptionRequest>,
) -> ServerResult<Response> {
    let diagnosed = state
        .backend_oidc_mode_auth_service()?
        .redeem_metadata_with_diagnosis(&payload)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/auth/token-set/backend-mode/metadata/redeem",
        method: "POST",
        status: match &result {
            Ok(Some(_)) => Some(200),
            Ok(None) => Some(StatusCode::NOT_FOUND.as_u16()),
            Err(error) => Some(error.to_http_status().as_u16()),
        },
    };
    match &result {
        Ok(_) => log_route_diagnosis(
            context,
            &diagnosis,
            "backend_oidc metadata redeem completed",
        ),
        Err(error) => log_route_diagnosis_error(
            context,
            &diagnosis,
            error,
            "backend_oidc metadata redeem failed",
        ),
    }

    match result.map_err(ServerError::from)? {
        Some(metadata) => Ok(Json(metadata).into_response()),
        None => Ok(backend_oidc_metadata_not_found_response()),
    }
}

/// POST /auth/token-set/backend-mode/user-info -- exchange id_token +
/// access_token for normalized user info.
pub async fn user_info(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<BackendOidcModeUserInfoRequest>,
) -> ServerResult<Response> {
    let Some(access_token) = extract_bearer_token(&headers) else {
        let diagnosis = backend_oidc_missing_access_token_diagnosis();
        log_route_diagnosis(
            RouteDiagnosisContext {
                route: "/auth/token-set/backend-mode/user-info",
                method: "POST",
                status: Some(StatusCode::UNAUTHORIZED.as_u16()),
            },
            &diagnosis,
            "backend_oidc user-info rejected",
        );
        return Err(backend_oidc_missing_access_token_error());
    };

    let diagnosed = state
        .backend_oidc_mode_auth_service()?
        .user_info_with_diagnosis(&payload, access_token)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/auth/token-set/backend-mode/user-info",
        method: "POST",
        status: result.as_ref().ok().map(|_| 200).or_else(|| {
            result
                .as_ref()
                .err()
                .map(|error| error.to_http_status().as_u16())
        }),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "backend_oidc user-info completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "backend_oidc user-info failed")
        }
    }
    let response = result.map_err(ServerError::from)?;

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

#[cfg(test)]
mod tests {
    use axum::{
        body::to_bytes,
        http::{StatusCode, header},
    };

    use super::*;

    #[tokio::test]
    async fn missing_access_token_error_uses_shared_server_error_envelope() {
        let response = backend_oidc_missing_access_token_error().into_response();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .expect("json envelope should set content type"),
            "application/json"
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        let envelope: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(envelope["status"], 401);
        assert_eq!(envelope["error"]["kind"], "unauthenticated");
        assert_eq!(
            envelope["error"]["code"],
            "backend_oidc_mode.bearer_token_required"
        );
    }

    #[tokio::test]
    async fn metadata_not_found_response_stays_plain_business_response() {
        let response = backend_oidc_metadata_not_found_response();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(response.headers().get(header::CONTENT_TYPE).is_none());

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");

        assert!(body.is_empty());
    }
}
