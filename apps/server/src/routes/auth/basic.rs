use std::net::SocketAddr;

use axum::{
    Extension, Router,
    extract::{ConnectInfo, Query},
    http::HeaderMap,
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::ServerError,
    http_response::into_axum_response,
    state::ServerState,
};

#[derive(Debug, Deserialize)]
pub struct BasicAuthLoginQuery {
    #[serde(default)]
    pub post_auth_redirect_uri: Option<String>,
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

    let diagnosed = state.basic_auth_context_service().login_diagnosed(
        "/basic/login",
        authorization,
        query.post_auth_redirect_uri.as_deref(),
        resolved_client_ip.as_ref(),
    );
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/basic/login",
        method: "GET",
        status: result
            .as_ref()
            .ok()
            .map(|response| response.status.as_u16()),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "Basic-auth login completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "Basic-auth login failed")
        }
    }
    result.map(into_axum_response).map_err(ServerError::from)
}

pub async fn logout(Extension(state): Extension<ServerState>) -> Response {
    let diagnosed = state
        .basic_auth_context_service()
        .logout_diagnosed("/basic/logout");
    let (diagnosis, result) = diagnosed.into_parts();
    let context = RouteDiagnosisContext {
        route: "/basic/logout",
        method: "POST",
        status: result
            .as_ref()
            .ok()
            .map(|response| response.status.as_u16()),
    };
    match &result {
        Ok(_) => log_route_diagnosis(context, &diagnosis, "Basic-auth logout completed"),
        Err(error) => {
            log_route_diagnosis_error(context, &diagnosis, error, "Basic-auth logout failed")
        }
    }
    into_axum_response(result.expect("basic-auth logout diagnosis should not fail at route layer"))
}
