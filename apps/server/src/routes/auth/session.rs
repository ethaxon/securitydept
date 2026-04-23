use axum::{
    Extension, Json,
    extract::Query,
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use securitydept_core::{
    oidc::OidcCodeCallbackSearchParams,
    session_context::{SessionAuthServiceTrait, SessionContext},
    utils::principal::AuthenticatedPrincipal,
};
use serde::Deserialize;
use tower_sessions::Session;

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
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
    let context = RouteDiagnosisContext {
        route: "/auth/session/login",
        method: "GET",
        status: result
            .as_ref()
            .ok()
            .map(|response| response.status.as_u16()),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "Session login completed"),
        Err(error) => log_route_diagnosis_error(context, &diagnosis, error, "Session login failed"),
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
    let diagnosed = state
        .session_auth_service()
        .callback_diagnosed(session, &external_base_url, search_params)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/auth/session/callback",
        method: "GET",
        status: result
            .as_ref()
            .ok()
            .map(|response| response.status.as_u16())
            .or_else(|| {
                result
                    .as_ref()
                    .err()
                    .map(|error| error.status_code().as_u16())
            }),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "Session callback completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "Session callback failed")
        }
    }

    result.map(into_axum_response).map_err(ServerError::from)
}

/// POST /auth/session/logout -- destroy session.
pub async fn logout(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Response> {
    let diagnosed = state.session_auth_service().logout_diagnosed(session).await;
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/auth/session/logout",
        method: "POST",
        status: result.as_ref().ok().map(|_| 200),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "Session logout completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "Session logout failed")
        }
    }
    let body = result.map_err(ServerError::from)?;

    Ok(Json(body).into_response())
}

/// GET /auth/session/user-info -- return current user info.
pub async fn user_info(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Json<AuthenticatedPrincipal>> {
    let diagnosed = state
        .session_auth_service()
        .user_info_diagnosed(session)
        .await;
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/auth/session/user-info",
        method: "GET",
        status: result.as_ref().ok().map(|_| 200),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "Session user-info completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "Session user-info failed")
        }
    }
    let context = result.map_err(ServerError::from)?;

    Ok(Json(session_user_info_response(context)))
}

fn session_user_info_response(context: SessionContext) -> AuthenticatedPrincipal {
    context.principal
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use securitydept_core::session_context::SessionContext;
    use serde_json::{Value, json};

    use super::session_user_info_response;

    #[test]
    fn session_user_info_response_preserves_shared_principal_identity_fields() {
        let mut claims = HashMap::new();
        claims.insert("role".to_string(), Value::String("admin".to_string()));

        let context = SessionContext::builder()
            .principal(
                securitydept_core::utils::principal::AuthenticatedPrincipal::builder()
                    .subject("session-user-1")
                    .display_name("Alice")
                    .picture("https://example.com/alice.png")
                    .issuer("https://issuer.example.com")
                    .claims(claims)
                    .build(),
            )
            .build();

        let response = session_user_info_response(context);

        assert_eq!(response.subject, "session-user-1");
        assert_eq!(
            response.issuer.as_deref(),
            Some("https://issuer.example.com")
        );
        assert_eq!(
            serde_json::to_value(&response).expect("response should serialize"),
            json!({
                "subject": "session-user-1",
                "display_name": "Alice",
                "picture": "https://example.com/alice.png",
                "issuer": "https://issuer.example.com",
                "claims": {
                    "role": "admin"
                }
            })
        );
    }
}
