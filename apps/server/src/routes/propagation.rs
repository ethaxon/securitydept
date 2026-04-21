use axum::{
    Extension,
    extract::Request,
    response::{IntoResponse, Response},
};

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::ServerError,
    state::ServerState,
};

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

    let diagnosed = resource_service
        .propagate_request_with_diagnosis(forwarder, request)
        .await;
    let diagnosis = diagnosed.diagnosis().clone();
    let response = diagnosed.into_result().map_err(|error| {
        log_route_diagnosis_error(
            RouteDiagnosisContext {
                route: "/api/propagation",
                method: "ANY",
                status: None,
            },
            &diagnosis,
            &error,
            "Propagation forwarding failed",
        );
        ServerError::InvalidConfig {
            message: format!("propagation forwarding failed: {error}"),
        }
    })?;

    log_route_diagnosis(
        RouteDiagnosisContext {
            route: "/api/propagation",
            method: "ANY",
            status: Some(response.status().as_u16()),
        },
        &diagnosis,
        "Propagation forwarding completed",
    );

    Ok(response.into_response())
}
