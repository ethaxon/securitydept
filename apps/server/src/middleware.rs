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
    utils::error::{
        ErrorPresentation, ServerErrorDescriptor, ServerErrorEnvelope, ServerErrorKind,
        UserRecovery,
    },
};
use serde_json::Value;
use tower_sessions::Session;
use tracing::{info, warn};

use crate::{error::ServerResult, http_response::into_axum_response, state::ServerState};

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
    match &authorization_result {
        Ok(true) => info!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "Basic-auth authorization succeeded"
        ),
        Ok(false) => info!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "Basic-auth authorization rejected"
        ),
        Err(error) => warn!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            error = %error,
            "Basic-auth authorization failed"
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
    let propagation =
        AccessTokenSubstrateResourceService::parse_propagation_directive(request.headers())
            .map_err(crate::error::ServerError::from)?;
    if propagation.is_some() && !state.substrate_runtime.propagation_enabled() {
        return Ok(propagation_not_enabled_response());
    }
    let has_cookie_header = request.headers().contains_key(header::COOKIE);

    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    if let Some(authorization) = authorization.as_deref()
        && let Some(_access_token) =
            securitydept_core::creds::parse_bearer_auth_header_opt(authorization)
    {
        let _resource_token_principal = state
            .resource_service()
            .ok_or(crate::error::ServerError::SessionContext {
                source: SessionContextError::MissingContext,
            })?
            .authenticate_authorization_header(Some(authorization))
            .await?
            .ok_or(crate::error::ServerError::SessionContext {
                source: SessionContextError::MissingContext,
            })?;

        return Ok(next.run(request).await);
    }

    if has_cookie_header {
        let handle = SessionContextSession::from_config(session, &state.config.session_context);

        if handle.get::<HashMap<String, Value>>().await?.is_some() {
            if propagation.is_some() {
                return Ok(propagation_auth_mismatch_response());
            }

            return Ok(next.run(request).await);
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
        let (diagnosis, authorization_result) = diagnosed.into_parts();
        match &authorization_result {
            Ok(true) => info!(
                operation = %diagnosis.operation,
                outcome = diagnosis.outcome.as_str(),
                diagnosis = %diagnosis.to_json_value(),
                "Dashboard basic-auth authorization succeeded"
            ),
            Ok(false) => info!(
                operation = %diagnosis.operation,
                outcome = diagnosis.outcome.as_str(),
                diagnosis = %diagnosis.to_json_value(),
                "Dashboard basic-auth authorization rejected"
            ),
            Err(error) => warn!(
                operation = %diagnosis.operation,
                outcome = diagnosis.outcome.as_str(),
                diagnosis = %diagnosis.to_json_value(),
                error = %error,
                "Dashboard basic-auth authorization failed"
            ),
        }

        if authorization_result? {
            if propagation.is_some() {
                return Ok(propagation_auth_mismatch_response());
            }
            return Ok(next.run(request).await);
        }
    }

    Err(crate::error::ServerError::SessionContext {
        source: SessionContextError::MissingContext,
    })
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
