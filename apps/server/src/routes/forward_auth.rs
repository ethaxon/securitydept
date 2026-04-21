use axum::{
    Extension,
    extract::Path,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use securitydept_core::{
    creds::{parse_basic_auth_header_opt, parse_bearer_auth_header_opt},
    creds_manage::auth::{check_basic_auth, check_token_auth},
    utils::observability::{
        AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowDiagnosisOutcome, AuthFlowOperation,
    },
};

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis},
    state::ServerState,
};

fn forward_auth_base_diagnosis(
    group: &str,
    headers: &HeaderMap,
    adapter: &str,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::FORWARD_AUTH_CHECK)
        .field(AuthFlowDiagnosisField::GROUP, group)
        .field(AuthFlowDiagnosisField::ADAPTER, adapter)
        .field(
            AuthFlowDiagnosisField::HAS_AUTHORIZATION_HEADER,
            headers.contains_key("authorization"),
        )
}

/// GET /api/forwardauth/traefik/:group
///
/// Traefik ForwardAuth: returns 200 if authenticated, 401 otherwise.
/// Checks the `Authorization` header forwarded by Traefik.
pub async fn traefik(
    Extension(state): Extension<ServerState>,
    Path(group): Path<String>,
    headers: HeaderMap,
) -> Response {
    match check_forward_auth(&state, &group, &headers, "traefik").await {
        Ok((entry_name, diagnosis)) => {
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/forwardauth/traefik/:group",
                    method: "GET",
                    status: Some(StatusCode::OK.as_u16()),
                },
                &diagnosis,
                "Traefik forward auth passed",
            );
            let mut resp_headers = HeaderMap::new();
            // Pass the authenticated entry name downstream
            if let Ok(val) = entry_name.parse() {
                resp_headers.insert("X-Auth-User", val);
            }
            (StatusCode::OK, resp_headers).into_response()
        }
        Err((status, diagnosis)) => {
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/forwardauth/traefik/:group",
                    method: "GET",
                    status: Some(status.as_u16()),
                },
                &diagnosis,
                "Traefik forward auth rejected",
            );
            unauthorized_with_challenge(status)
        }
    }
}

/// GET /api/forwardauth/nginx/:group
///
/// Nginx auth_request: returns 200 if authenticated, 401 otherwise.
/// Checks the `Authorization` header forwarded by Nginx.
pub async fn nginx(
    Extension(state): Extension<ServerState>,
    Path(group): Path<String>,
    headers: HeaderMap,
) -> Response {
    match check_forward_auth(&state, &group, &headers, "nginx").await {
        Ok((entry_name, diagnosis)) => {
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/forwardauth/nginx/:group",
                    method: "GET",
                    status: Some(StatusCode::OK.as_u16()),
                },
                &diagnosis,
                "Nginx forward auth passed",
            );
            let mut resp_headers = HeaderMap::new();
            if let Ok(val) = entry_name.parse() {
                resp_headers.insert("X-Auth-User", val);
            }
            (StatusCode::OK, resp_headers).into_response()
        }
        Err((status, diagnosis)) => {
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/forwardauth/nginx/:group",
                    method: "GET",
                    status: Some(status.as_u16()),
                },
                &diagnosis,
                "Nginx forward auth rejected",
            );
            unauthorized_with_challenge(status)
        }
    }
}

fn unauthorized_with_challenge(status: StatusCode) -> Response {
    if status != StatusCode::UNAUTHORIZED {
        return status.into_response();
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        "WWW-Authenticate",
        HeaderValue::from_static(r#"Basic realm="securitydept", Bearer realm="securitydept""#),
    );
    (StatusCode::UNAUTHORIZED, headers).into_response()
}

/// Shared logic: extract credentials and validate against group entries.
async fn check_forward_auth(
    state: &ServerState,
    group: &str,
    headers: &HeaderMap,
    adapter: &str,
) -> Result<(String, AuthFlowDiagnosis), (StatusCode, AuthFlowDiagnosis)> {
    let diagnosis = forward_auth_base_diagnosis(group, headers, adapter);

    let Some(group_obj) = state.creds_manage_store.find_group_by_name(group).await else {
        return Err((
            StatusCode::UNAUTHORIZED,
            diagnosis
                .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                .field(AuthFlowDiagnosisField::REASON, "group_not_found"),
        ));
    };

    let basic_entries = state
        .creds_manage_store
        .basic_entries_by_group_id(&group_obj.id)
        .await;
    let token_entries = state
        .creds_manage_store
        .token_entries_by_group_id(&group_obj.id)
        .await;

    if basic_entries.is_empty() && token_entries.is_empty() {
        return Err((
            StatusCode::UNAUTHORIZED,
            diagnosis
                .clone()
                .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                .field(AuthFlowDiagnosisField::GROUP_ID, group_obj.id.to_string())
                .field(AuthFlowDiagnosisField::REASON, "group_has_no_entries"),
        ));
    }

    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let Some(auth_header) = auth_header else {
        return Err((
            StatusCode::UNAUTHORIZED,
            diagnosis
                .clone()
                .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                .field(AuthFlowDiagnosisField::GROUP_ID, group_obj.id.to_string())
                .field(
                    AuthFlowDiagnosisField::REASON,
                    "missing_authorization_header",
                ),
        ));
    };

    // Try basic auth first
    if let Some((username, password)) = parse_basic_auth_header_opt(auth_header) {
        match check_basic_auth(&basic_entries, &username, &password) {
            Ok(Some(name)) => {
                return Ok((
                    name.clone(),
                    diagnosis
                        .clone()
                        .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                        .field("group_id", group_obj.id.to_string())
                        .field("auth_scheme", "basic")
                        .field("entry_name", name),
                ));
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(group = %group, username = %username, error = %error, "Basic credential validation failed");
            }
        }
    }

    // Try bearer token
    if let Some(token) = parse_bearer_auth_header_opt(auth_header) {
        match check_token_auth(&token_entries, &token) {
            Ok(Some(name)) => {
                return Ok((
                    name.clone(),
                    diagnosis
                        .clone()
                        .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                        .field("group_id", group_obj.id.to_string())
                        .field("auth_scheme", "bearer")
                        .field("entry_name", name),
                ));
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(group = %group, error = %error, "Token credential validation failed");
            }
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        diagnosis
            .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
            .field(AuthFlowDiagnosisField::GROUP_ID, group_obj.id.to_string())
            .field(AuthFlowDiagnosisField::REASON, "no_valid_credentials"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forward_auth_base_diagnosis_uses_shared_operation_vocabulary() {
        let headers = HeaderMap::new();
        let diagnosis = forward_auth_base_diagnosis("ops", &headers, "traefik");

        assert_eq!(diagnosis.operation, AuthFlowOperation::FORWARD_AUTH_CHECK);
        assert_eq!(diagnosis.fields[AuthFlowDiagnosisField::GROUP], "ops");
        assert_eq!(diagnosis.fields[AuthFlowDiagnosisField::ADAPTER], "traefik");
    }
}
