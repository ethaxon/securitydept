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
    utils::error::{ErrorPresentation, UserRecovery},
};
use serde_json::Value;
use tower_sessions::Session;

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

    if state
        .basic_auth_context_service()
        .authorize_request(authorization.as_deref(), resolved_client_ip.as_ref())
        .map_err(crate::error::ServerError::from)?
    {
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

        if state
            .basic_auth_context_service()
            .authorize_request(Some(authorization), resolved_client_ip.as_ref())?
        {
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
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "error": presentation,
            "status": StatusCode::UNAUTHORIZED.as_u16(),
            "success": false
        })),
    )
        .into_response()
}

fn propagation_not_enabled_response() -> Response {
    let presentation = ErrorPresentation::new(
        "propagation_disabled",
        "This request requires propagation, but the propagation capability is disabled on this \
         server.",
        UserRecovery::None,
    );
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": presentation,
            "status": StatusCode::BAD_REQUEST.as_u16(),
            "success": false
        })),
    )
        .into_response()
}
