use axum::{
    Extension,
    extract::Request,
    response::{IntoResponse, Response},
};

use crate::{error::ServerError, state::ServerState};

/// Catch-all handler for propagation-aware forwarding.
///
/// Delegates entirely to
/// [`AccessTokenSubstrateResourceService::propagate_request`], which extracts
/// the bearer token and propagation directive from the request headers,
/// verifies the token, and forwards the request to the downstream target.
pub async fn propagation_forward(
    Extension(state): Extension<ServerState>,
    request: Request,
) -> Result<Response, ServerError> {
    let forwarder =
        state
            .propagation_forwarder
            .as_deref()
            .ok_or_else(|| ServerError::InvalidConfig {
                message: "propagation forwarding is not enabled on this server".to_string(),
            })?;

    let resource_service = state
        .resource_service()
        .ok_or_else(|| ServerError::InvalidConfig {
            message: "propagation forwarding requires resource server verification to be \
                      configured"
                .to_string(),
        })?;

    let response = resource_service
        .propagate_request(forwarder, request)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Propagation forwarding failed");
            ServerError::InvalidConfig {
                message: format!("propagation forwarding failed: {e}"),
            }
        })?;

    Ok(response.into_response())
}
