use axum::{
    Extension, Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use securitydept_core::utils::error::{ErrorPresentation, UserRecovery};

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::{ServerError, ServerResult},
    state::ServerState,
};

fn frontend_oidc_projection_failed_error(source: &std::io::Error) -> ServerError {
    ServerError::route_presentation(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorPresentation::new(
            "frontend_oidc_mode.config_projection_unavailable",
            "Frontend sign-in configuration is temporarily unavailable.",
            UserRecovery::Retry,
        ),
        format!("frontend_oidc projection: {source}"),
    )
}

/// GET /api/auth/token-set/frontend-mode/config -- project frontend-owned OIDC
/// config for the browser runtime.
pub async fn config_projection(Extension(state): Extension<ServerState>) -> ServerResult<Response> {
    let diagnosed = state
        .frontend_oidc_mode_service()?
        .config_projection_with_diagnosis()
        .await;
    let diagnosis = diagnosed.diagnosis().clone();
    let projection = diagnosed.into_result().map_err(|source| {
        log_route_diagnosis_error(
            RouteDiagnosisContext {
                route: "/api/auth/token-set/frontend-mode/config",
                method: "GET",
                status: None,
            },
            &diagnosis,
            &source,
            "frontend_oidc config projection failed",
        );
        frontend_oidc_projection_failed_error(&source)
    })?;

    log_route_diagnosis(
        RouteDiagnosisContext {
            route: "/api/auth/token-set/frontend-mode/config",
            method: "GET",
            status: Some(200),
        },
        &diagnosis,
        "frontend_oidc config projection completed",
    );

    Ok(Json(projection).into_response())
}
