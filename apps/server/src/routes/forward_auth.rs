use axum::Extension;
use axum::extract::Path;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use tracing::{debug, warn};

use securitydept_core::auth::{
    check_basic_auth, check_token_auth, parse_basic_auth_header, parse_bearer_auth_header,
};

use crate::state::AppState;

/// GET /api/forwardauth/traefik/:group
///
/// Traefik ForwardAuth: returns 200 if authenticated, 401 otherwise.
/// Checks the `Authorization` header forwarded by Traefik.
pub async fn traefik(
    Extension(state): Extension<AppState>,
    Path(group): Path<String>,
    headers: HeaderMap,
) -> Response {
    match check_forward_auth(&state, &group, &headers).await {
        Ok(entry_name) => {
            debug!(group = %group, entry = %entry_name, "Traefik forward auth passed");
            let mut resp_headers = HeaderMap::new();
            // Pass the authenticated entry name downstream
            if let Ok(val) = entry_name.parse() {
                resp_headers.insert("X-Auth-User", val);
            }
            (StatusCode::OK, resp_headers).into_response()
        }
        Err(status) => unauthorized_with_challenge(status),
    }
}

/// GET /api/forwardauth/nginx/:group
///
/// Nginx auth_request: returns 200 if authenticated, 401 otherwise.
/// Checks the `Authorization` header forwarded by Nginx.
pub async fn nginx(
    Extension(state): Extension<AppState>,
    Path(group): Path<String>,
    headers: HeaderMap,
) -> Response {
    match check_forward_auth(&state, &group, &headers).await {
        Ok(entry_name) => {
            debug!(group = %group, entry = %entry_name, "Nginx forward auth passed");
            let mut resp_headers = HeaderMap::new();
            if let Ok(val) = entry_name.parse() {
                resp_headers.insert("X-Auth-User", val);
            }
            (StatusCode::OK, resp_headers).into_response()
        }
        Err(status) => unauthorized_with_challenge(status),
    }
}

fn unauthorized_with_challenge(status: StatusCode) -> Response {
    if status != StatusCode::UNAUTHORIZED {
        return status.into_response();
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        "WWW-Authenticate",
        HeaderValue::from_static(r#"Basic realm="securitydept", Bearer realm="securitydept""#),
    );
    (StatusCode::UNAUTHORIZED, headers).into_response()
}

/// Shared logic: extract credentials and validate against group entries.
async fn check_forward_auth(
    state: &AppState,
    group: &str,
    headers: &HeaderMap,
) -> Result<String, StatusCode> {
    let Some(group_obj) = state.store.find_group_by_name(group).await else {
        warn!(group = %group, "Forward auth rejected: group not found");
        return Err(StatusCode::UNAUTHORIZED);
    };

    let entries = state.store.entries_by_group_id(&group_obj.id).await;

    if entries.is_empty() {
        warn!(
            group = %group,
            group_id = %group_obj.id,
            "Forward auth rejected: no entries found for group"
        );
        return Err(StatusCode::UNAUTHORIZED);
    }

    let auth_header = headers.get("authorization").and_then(|v| v.to_str().ok());
    let Some(auth_header) = auth_header else {
        warn!(
            group = %group,
            "Forward auth rejected: missing Authorization header"
        );
        return Err(StatusCode::UNAUTHORIZED);
    };

    // Try basic auth first
    if let Some((username, password)) = parse_basic_auth_header(auth_header) {
        match check_basic_auth(&entries, &username, &password) {
            Ok(Some(name)) => return Ok(name),
            Ok(None) => {}
            Err(error) => {
                warn!(
                    group = %group,
                    username = %username,
                    error = %error,
                    "Basic credential validation failed"
                );
            }
        }
    }

    // Try bearer token
    if let Some(token) = parse_bearer_auth_header(auth_header)
        && let Some(name) = check_token_auth(&entries, &token)
    {
        return Ok(name);
    }

    warn!(
        group = %group,
        "Forward auth rejected: no valid credentials matched"
    );
    Err(StatusCode::UNAUTHORIZED)
}
