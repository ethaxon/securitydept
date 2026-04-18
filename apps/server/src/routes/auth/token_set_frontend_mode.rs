use axum::{
    Extension, Json,
    extract::Query,
    response::{IntoResponse, Response},
};
use securitydept_core::utils::observability::AuthFlowDiagnosisOutcome;
use serde::Deserialize;

use crate::{
    error::{ServerError, ServerResult},
    state::ServerState,
};

#[derive(Debug, Deserialize, Default)]
pub struct TokenSetFrontendModeConfigProjectionQuery {
    pub redirect_uri: Option<String>,
}

/// GET /api/auth/token-set/frontend-mode/config -- project frontend-owned OIDC
/// config for the browser runtime.
pub async fn config_projection(
    Extension(state): Extension<ServerState>,
    Query(query): Query<TokenSetFrontendModeConfigProjectionQuery>,
) -> ServerResult<Response> {
    let diagnosed = state
        .frontend_oidc_mode_service()?
        .config_projection_with_diagnosis()
        .await;
    let diagnosis = diagnosed.diagnosis().clone();
    let mut projection = diagnosed.into_result().map_err(|source| {
        tracing::warn!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            error = %source,
            "frontend_oidc config projection failed"
        );
        ServerError::InvalidConfig {
            message: format!("frontend_oidc projection: {source}"),
        }
    })?;

    // The host may supply a runtime callback target so the browser-owned
    // frontend mode completes on the real webui callback route.
    if let Some(redirect_uri) = query.redirect_uri {
        projection.redirect_url = redirect_uri;
    }

    if matches!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Succeeded) {
        tracing::info!(
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "frontend_oidc config projection succeeded"
        );
    }

    Ok(Json(projection).into_response())
}
