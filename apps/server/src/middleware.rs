use std::{collections::HashMap, net::SocketAddr};

use axum::{
    Extension, Json,
    extract::{ConnectInfo, Request},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use securitydept_core::{
    session_context::{SessionContextError, SessionContextSession},
    token_set_context::access_token_substrate::AccessTokenSubstrateResourceService,
    utils::{
        error::{
            ErrorPresentation, ServerErrorDescriptor, ServerErrorEnvelope, ServerErrorKind,
            UserRecovery,
        },
        observability::{
            AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowDiagnosisOutcome, AuthFlowOperation,
        },
    },
};
use serde_json::Value;
use tower_sessions::Session;

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::ServerResult,
    http_response::into_axum_response,
    state::ServerState,
};

const BASIC_AUTH_ROUTE: &str = "/basic/*";
const DASHBOARD_AUTH_ROUTE: &str = "/api/*";
const AUTH_FAMILY_DASHBOARD: &str = "dashboard";
const CREDENTIAL_SOURCE_BEARER: &str = "bearer_authorization";
const CREDENTIAL_SOURCE_BASIC: &str = "basic_authorization";
const CREDENTIAL_SOURCE_SESSION: &str = "session_cookie";
const CREDENTIAL_SOURCE_AUTHORIZATION: &str = "authorization_header";
const CREDENTIAL_SOURCE_NONE: &str = "none";

pub async fn require_basic_auth(
    Extension(state): Extension<ServerState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> ServerResult<Response> {
    let propagation =
        AccessTokenSubstrateResourceService::parse_propagation_directive(request.headers())
            .map_err(crate::error::ServerError::from)?;

    if propagation.is_some() {
        if !state.substrate_runtime.propagation_enabled() {
            return Ok(propagation_not_enabled_response());
        }
        return Ok(propagation_auth_mismatch_response());
    }

    let request_path = request.uri().path().to_string();
    let resolved_client_ip = state
        .resolve_client_ip(request.headers(), Some(peer_addr))
        .await;
    let authorization = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    let diagnosed = state
        .basic_auth_context_service()
        .authorize_request_diagnosed(authorization.as_deref(), resolved_client_ip.as_ref());
    let (diagnosis, authorization_result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: BASIC_AUTH_ROUTE,
        method: request.method().as_str(),
        status: None,
    };
    match &authorization_result {
        Ok(true) => log_route_diagnosis(context, &diagnosis, "Basic-auth authorization succeeded"),
        Ok(false) => log_route_diagnosis(context, &diagnosis, "Basic-auth authorization rejected"),
        Err(error) => log_route_diagnosis_error(
            context,
            &diagnosis,
            error,
            "Basic-auth authorization failed",
        ),
    }

    if authorization_result.map_err(crate::error::ServerError::from)? {
        Ok(next.run(request).await)
    } else if let Some(zone) = state
        .basic_auth_context
        .zone_for_request_path(&request_path)
    {
        Ok(into_axum_response(
            zone.unauthorized_response_for_path(&request_path),
        ))
    } else {
        Ok(axum::http::StatusCode::NOT_FOUND.into_response())
    }
}

pub async fn require_dashboard_auth(
    Extension(state): Extension<ServerState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    session: Session,
    request: Request,
    next: Next,
) -> ServerResult<Response> {
    let has_cookie_header = request.headers().contains_key(header::COOKIE);
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let has_authorization_header = authorization.is_some();
    let propagation =
        AccessTokenSubstrateResourceService::parse_propagation_directive(request.headers())
            .map_err(crate::error::ServerError::from)?;
    let has_propagation_directive = propagation.is_some();
    let propagation_enabled = state.substrate_runtime.propagation_enabled();

    if has_propagation_directive && !propagation_enabled {
        let diagnosis = propagation_not_enabled_diagnosis(
            dashboard_credential_source(authorization.as_deref(), has_cookie_header),
            has_cookie_header,
            has_authorization_header,
        );
        log_route_diagnosis(
            RouteDiagnosisContext {
                route: DASHBOARD_AUTH_ROUTE,
                method: request.method().as_str(),
                status: Some(StatusCode::BAD_REQUEST.as_u16()),
            },
            &diagnosis,
            "Dashboard auth rejected because propagation is disabled",
        );
        return Ok(propagation_not_enabled_response());
    }

    if let Some(authorization) = authorization.as_deref()
        && let Some(_access_token) =
            securitydept_core::creds::parse_bearer_auth_header_opt(authorization)
    {
        let Some(resource_service) = state.resource_service() else {
            let diagnosis = dashboard_auth_diagnosis(
                AuthFlowDiagnosisOutcome::Failed,
                CREDENTIAL_SOURCE_BEARER,
                has_cookie_header,
                has_authorization_header,
                has_propagation_directive,
                propagation_enabled,
                "resource_service_unavailable",
            );
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: DASHBOARD_AUTH_ROUTE,
                    method: request.method().as_str(),
                    status: None,
                },
                &diagnosis,
                "Dashboard bearer authentication failed before verification",
            );
            return Err(crate::error::ServerError::SessionContext {
                source: SessionContextError::MissingContext,
            });
        };

        let resource_token_principal = match resource_service
            .authenticate_authorization_header(Some(authorization))
            .await
        {
            Ok(Some(principal)) => principal,
            Ok(None) => {
                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Rejected,
                    CREDENTIAL_SOURCE_BEARER,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "resource_token_rejected",
                );
                log_route_diagnosis(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: Some(StatusCode::UNAUTHORIZED.as_u16()),
                    },
                    &diagnosis,
                    "Dashboard bearer authentication rejected",
                );
                return Err(crate::error::ServerError::SessionContext {
                    source: SessionContextError::MissingContext,
                });
            }
            Err(error) => {
                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Failed,
                    CREDENTIAL_SOURCE_BEARER,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "resource_token_verification_failed",
                );
                log_route_diagnosis_error(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: None,
                    },
                    &diagnosis,
                    &error,
                    "Dashboard bearer authentication failed",
                );
                return Err(crate::error::ServerError::from(error));
            }
        };

        let diagnosis = bearer_accepted_diagnosis(
            has_cookie_header,
            has_authorization_header,
            has_propagation_directive,
            propagation_enabled,
        )
        .field(
            AuthFlowDiagnosisField::SUBJECT,
            resource_token_principal.subject.clone(),
        );
        log_route_diagnosis(
            RouteDiagnosisContext {
                route: DASHBOARD_AUTH_ROUTE,
                method: request.method().as_str(),
                status: Some(StatusCode::OK.as_u16()),
            },
            &diagnosis,
            "Dashboard bearer authentication succeeded",
        );

        return Ok(next.run(request).await);
    }

    if has_cookie_header {
        let handle = SessionContextSession::from_config(session, &state.config.session_context);

        match handle.get::<HashMap<String, Value>>().await {
            Ok(Some(_)) => {
                if has_propagation_directive {
                    let diagnosis = propagation_auth_mismatch_diagnosis(
                        CREDENTIAL_SOURCE_SESSION,
                        has_cookie_header,
                        has_authorization_header,
                    );
                    log_route_diagnosis(
                        RouteDiagnosisContext {
                            route: DASHBOARD_AUTH_ROUTE,
                            method: request.method().as_str(),
                            status: Some(StatusCode::UNAUTHORIZED.as_u16()),
                        },
                        &diagnosis,
                        "Dashboard propagation rejected non-bearer session auth",
                    );
                    return Ok(propagation_auth_mismatch_response());
                }

                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Succeeded,
                    CREDENTIAL_SOURCE_SESSION,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "session_context_present",
                );
                log_route_diagnosis(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: Some(StatusCode::OK.as_u16()),
                    },
                    &diagnosis,
                    "Dashboard session-cookie authentication succeeded",
                );

                return Ok(next.run(request).await);
            }
            Ok(None) => {
                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Rejected,
                    CREDENTIAL_SOURCE_SESSION,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "session_context_missing",
                );
                log_route_diagnosis(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: Some(StatusCode::UNAUTHORIZED.as_u16()),
                    },
                    &diagnosis,
                    "Dashboard session-cookie authentication rejected",
                );
            }
            Err(error) => {
                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Failed,
                    CREDENTIAL_SOURCE_SESSION,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "session_lookup_failed",
                );
                log_route_diagnosis_error(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: None,
                    },
                    &diagnosis,
                    &error,
                    "Dashboard session-cookie lookup failed",
                );
                return Err(crate::error::ServerError::from(error));
            }
        }
    }

    if let Some(authorization) = authorization.as_deref()
        && securitydept_core::creds::is_basic_auth_header(authorization)
    {
        let resolved_client_ip = state
            .resolve_client_ip(request.headers(), Some(peer_addr))
            .await;

        let diagnosed = state
            .basic_auth_context_service()
            .authorize_request_diagnosed(Some(authorization), resolved_client_ip.as_ref());
        let (_, authorization_result) = diagnosed.into_parts();

        match authorization_result {
            Ok(true) => {
                if has_propagation_directive {
                    let diagnosis = propagation_auth_mismatch_diagnosis(
                        CREDENTIAL_SOURCE_BASIC,
                        has_cookie_header,
                        has_authorization_header,
                    );
                    log_route_diagnosis(
                        RouteDiagnosisContext {
                            route: DASHBOARD_AUTH_ROUTE,
                            method: request.method().as_str(),
                            status: Some(StatusCode::UNAUTHORIZED.as_u16()),
                        },
                        &diagnosis,
                        "Dashboard propagation rejected basic auth",
                    );
                    return Ok(propagation_auth_mismatch_response());
                }

                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Succeeded,
                    CREDENTIAL_SOURCE_BASIC,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "basic_credentials_accepted",
                );
                log_route_diagnosis(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: Some(StatusCode::OK.as_u16()),
                    },
                    &diagnosis,
                    "Dashboard basic-auth authentication succeeded",
                );
                return Ok(next.run(request).await);
            }
            Ok(false) => {
                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Rejected,
                    CREDENTIAL_SOURCE_BASIC,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "basic_credentials_rejected",
                );
                log_route_diagnosis(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: Some(StatusCode::UNAUTHORIZED.as_u16()),
                    },
                    &diagnosis,
                    "Dashboard basic-auth authentication rejected",
                );
            }
            Err(error) => {
                let diagnosis = dashboard_auth_diagnosis(
                    AuthFlowDiagnosisOutcome::Failed,
                    CREDENTIAL_SOURCE_BASIC,
                    has_cookie_header,
                    has_authorization_header,
                    has_propagation_directive,
                    propagation_enabled,
                    "basic_authorization_failed",
                );
                log_route_diagnosis_error(
                    RouteDiagnosisContext {
                        route: DASHBOARD_AUTH_ROUTE,
                        method: request.method().as_str(),
                        status: None,
                    },
                    &diagnosis,
                    &error,
                    "Dashboard basic-auth authentication failed",
                );
                return Err(crate::error::ServerError::from(error));
            }
        }
    }

    let diagnosis = no_accepted_dashboard_auth_diagnosis(
        has_cookie_header,
        has_authorization_header,
        has_propagation_directive,
        propagation_enabled,
    );
    log_route_diagnosis(
        RouteDiagnosisContext {
            route: DASHBOARD_AUTH_ROUTE,
            method: request.method().as_str(),
            status: Some(StatusCode::UNAUTHORIZED.as_u16()),
        },
        &diagnosis,
        "Dashboard authentication rejected because no supported auth method was accepted",
    );

    Err(crate::error::ServerError::SessionContext {
        source: SessionContextError::MissingContext,
    })
}

fn dashboard_credential_source(
    authorization: Option<&str>,
    has_cookie_header: bool,
) -> &'static str {
    if let Some(authorization) = authorization {
        if securitydept_core::creds::parse_bearer_auth_header_opt(authorization).is_some() {
            return CREDENTIAL_SOURCE_BEARER;
        }
        if securitydept_core::creds::is_basic_auth_header(authorization) {
            return CREDENTIAL_SOURCE_BASIC;
        }
        return CREDENTIAL_SOURCE_AUTHORIZATION;
    }

    if has_cookie_header {
        return CREDENTIAL_SOURCE_SESSION;
    }

    CREDENTIAL_SOURCE_NONE
}

fn dashboard_auth_diagnosis(
    outcome: AuthFlowDiagnosisOutcome,
    credential_source: &str,
    has_cookie_header: bool,
    has_authorization_header: bool,
    has_propagation_directive: bool,
    propagation_enabled: bool,
    reason: &str,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::DASHBOARD_AUTH_CHECK)
        .with_outcome(outcome)
        .field(AuthFlowDiagnosisField::AUTH_FAMILY, AUTH_FAMILY_DASHBOARD)
        .field(AuthFlowDiagnosisField::CREDENTIAL_SOURCE, credential_source)
        .field(AuthFlowDiagnosisField::HAS_COOKIE_HEADER, has_cookie_header)
        .field(
            AuthFlowDiagnosisField::HAS_AUTHORIZATION_HEADER,
            has_authorization_header,
        )
        .field(
            AuthFlowDiagnosisField::HAS_PROPAGATION_DIRECTIVE,
            has_propagation_directive,
        )
        .field(
            AuthFlowDiagnosisField::PROPAGATION_ENABLED,
            propagation_enabled,
        )
        .field(AuthFlowDiagnosisField::REASON, reason)
}

fn bearer_accepted_diagnosis(
    has_cookie_header: bool,
    has_authorization_header: bool,
    has_propagation_directive: bool,
    propagation_enabled: bool,
) -> AuthFlowDiagnosis {
    dashboard_auth_diagnosis(
        AuthFlowDiagnosisOutcome::Succeeded,
        CREDENTIAL_SOURCE_BEARER,
        has_cookie_header,
        has_authorization_header,
        has_propagation_directive,
        propagation_enabled,
        "bearer_accepted",
    )
}

fn propagation_not_enabled_diagnosis(
    credential_source: &str,
    has_cookie_header: bool,
    has_authorization_header: bool,
) -> AuthFlowDiagnosis {
    dashboard_auth_diagnosis(
        AuthFlowDiagnosisOutcome::Failed,
        credential_source,
        has_cookie_header,
        has_authorization_header,
        true,
        false,
        "propagation_disabled",
    )
}

fn propagation_auth_mismatch_diagnosis(
    credential_source: &str,
    has_cookie_header: bool,
    has_authorization_header: bool,
) -> AuthFlowDiagnosis {
    dashboard_auth_diagnosis(
        AuthFlowDiagnosisOutcome::Rejected,
        credential_source,
        has_cookie_header,
        has_authorization_header,
        true,
        true,
        "propagation_requires_bearer",
    )
}

fn no_accepted_dashboard_auth_diagnosis(
    has_cookie_header: bool,
    has_authorization_header: bool,
    has_propagation_directive: bool,
    propagation_enabled: bool,
) -> AuthFlowDiagnosis {
    dashboard_auth_diagnosis(
        AuthFlowDiagnosisOutcome::Rejected,
        dashboard_credential_source(None, has_cookie_header),
        has_cookie_header,
        has_authorization_header,
        has_propagation_directive,
        propagation_enabled,
        "no_accepted_auth_method",
    )
}

fn propagation_auth_mismatch_response() -> Response {
    let presentation = ErrorPresentation::new(
        "propagation_auth_method_mismatch",
        "This request requires bearer token authentication for propagation.",
        UserRecovery::Reauthenticate,
    );

    shared_error_response(StatusCode::UNAUTHORIZED, presentation)
}

fn propagation_not_enabled_response() -> Response {
    let presentation = ErrorPresentation::new(
        "propagation_disabled",
        "This request requires propagation, but the propagation capability is disabled on this \
         server.",
        UserRecovery::None,
    );

    shared_error_response(StatusCode::BAD_REQUEST, presentation)
}

fn shared_error_response(status: StatusCode, presentation: ErrorPresentation) -> Response {
    let error = ServerErrorDescriptor::new(
        ServerErrorKind::from_http_status(status.as_u16()),
        presentation,
    );

    (
        status,
        Json(ServerErrorEnvelope::new(status.as_u16(), error)),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_accepted_diagnosis_marks_bearer_resource_access() {
        let diagnosis = bearer_accepted_diagnosis(false, true, false, true);

        assert_eq!(diagnosis.operation, AuthFlowOperation::DASHBOARD_AUTH_CHECK);
        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Succeeded);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::CREDENTIAL_SOURCE],
            CREDENTIAL_SOURCE_BEARER
        );
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::REASON],
            "bearer_accepted"
        );
    }

    #[test]
    fn propagation_not_enabled_diagnosis_marks_server_capability_failure() {
        let diagnosis = propagation_not_enabled_diagnosis(CREDENTIAL_SOURCE_BEARER, false, true);

        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Failed);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::PROPAGATION_ENABLED],
            false
        );
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::REASON],
            "propagation_disabled"
        );
    }

    #[test]
    fn propagation_auth_mismatch_diagnosis_marks_non_bearer_request_rejection() {
        let diagnosis = propagation_auth_mismatch_diagnosis(CREDENTIAL_SOURCE_SESSION, true, false);

        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Rejected);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::CREDENTIAL_SOURCE],
            CREDENTIAL_SOURCE_SESSION
        );
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::REASON],
            "propagation_requires_bearer"
        );
    }

    #[test]
    fn no_accepted_dashboard_auth_diagnosis_marks_missing_supported_auth() {
        let diagnosis = no_accepted_dashboard_auth_diagnosis(false, false, false, true);

        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Rejected);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::CREDENTIAL_SOURCE],
            CREDENTIAL_SOURCE_NONE
        );
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::REASON],
            "no_accepted_auth_method"
        );
    }
}
