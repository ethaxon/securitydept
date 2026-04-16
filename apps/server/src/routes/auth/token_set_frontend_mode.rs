use axum::{
    Extension, Json,
    extract::Query,
    response::{IntoResponse, Response},
};
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
    let mut projection = state
        .frontend_oidc_mode_service()?
        .config_projection()
        .await
        .map_err(|source| ServerError::InvalidConfig {
            message: format!("frontend_oidc projection: {source}"),
        })?;

    // The host may supply a runtime callback target so the browser-owned
    // frontend mode completes on the real webui callback route.
    if let Some(redirect_uri) = query.redirect_uri {
        projection.redirect_url = redirect_uri;
    }

    Ok(Json(projection).into_response())
}
