use std::net::SocketAddr;

use axum::{
    Extension, Router,
    extract::{ConnectInfo, Query},
    http::HeaderMap,
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;

use crate::{error::ServerError, http_response::into_axum_response, state::ServerState};

#[derive(Debug, Deserialize)]
pub struct BasicAuthLoginQuery {
    #[serde(default)]
    pub post_auth_redirect: Option<String>,
}

pub fn router() -> Router {
    Router::new()
        .route("/login", get(login))
        .route("/logout", post(logout))
}

pub async fn login(
    Extension(state): Extension<ServerState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<BasicAuthLoginQuery>,
) -> Result<Response, ServerError> {
    let authorization = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let resolved_client_ip = state.resolve_client_ip(&headers, Some(peer_addr)).await;

    state
        .basic_auth_context_service()
        .login(
            "/basic/login",
            authorization,
            query.post_auth_redirect.as_deref(),
            resolved_client_ip.as_ref(),
        )
        .map(into_axum_response)
        .map_err(ServerError::from)
}

pub async fn logout(Extension(state): Extension<ServerState>) -> Response {
    into_axum_response(state.basic_auth_context_service().logout("/basic/logout"))
}
