use axum::{
    Extension,
    extract::Request,
    response::{IntoResponse, Response},
};
use tracing::debug;

use crate::{error::ServerError, middleware::DashboardAuthContext, state::ServerState};

/// Catch-all handler for propagation-aware forwarding.
///
/// When the dashboard auth context is `Bearer` with a propagation directive,
/// this handler uses the `AxumReverseProxyPropagationForwarder` to forward
/// the request (with a validated bearer token) to the resolved downstream.
pub async fn propagation_forward(
    Extension(state): Extension<ServerState>,
    Extension(auth_context): Extension<DashboardAuthContext>,
    request: Request,
) -> Result<Response, ServerError> {
    let forwarder = state.propagation_forwarder.as_deref().ok_or_else(|| {
        ServerError::InvalidConfig {
            message: "propagation forwarding is not enabled on this server".to_string(),
        }
    })?;

    let bearer = auth_context
        .propagated_bearer()
        .ok_or(ServerError::InvalidConfig {
            message: "propagation forwarding requires bearer authentication".to_string(),
        })?;

    let target = auth_context
        .propagation_target()
        .ok_or(ServerError::InvalidConfig {
            message: "propagation forwarding requires a propagation directive".to_string(),
        })?;

    debug!(
        target = %target_display(&target),
        "Forwarding propagation request"
    );

    let response = forwarder
        .forward(
            state.token_set_context.token_propagator(),
            &bearer,
            &target,
            request,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Propagation forwarding failed");
            ServerError::InvalidConfig {
                message: format!("propagation forwarding failed: {e}"),
            }
        })?;

    Ok(response.into_response())
}

fn target_display(
    target: &securitydept_core::token_set_context::PropagationRequestTarget,
) -> String {
    format!(
        "{}://{}:{}",
        target
            .scheme
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("unknown"),
        target.hostname.as_deref().unwrap_or("unknown"),
        target
            .port
            .map(|p| p.to_string())
            .unwrap_or_else(|| "default".to_string()),
    )
}
