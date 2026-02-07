use axum::Json;
use axum::extract::Query;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Default)]
pub struct HealthQuery {
    #[serde(default)]
    pub api_details: bool,
}

#[derive(Debug, Serialize)]
pub struct ApiRouteInfo {
    pub method: &'static str,
    pub path: &'static str,
    pub auth_required: bool,
    pub description: &'static str,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apis: Option<Vec<ApiRouteInfo>>,
}

/// GET /api/health (and /health for compatibility)
///
/// Query:
/// - api_details=true: include supported API list
pub async fn health(Query(query): Query<HealthQuery>) -> Json<HealthResponse> {
    let apis = if query.api_details {
        Some(vec![
            ApiRouteInfo {
                method: "GET",
                path: "/api/health",
                auth_required: false,
                description: "Service health and optional API metadata",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/auth/login",
                auth_required: false,
                description: "Start OIDC login flow (or dev session when OIDC disabled)",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/auth/callback",
                auth_required: false,
                description: "OIDC callback endpoint",
            },
            ApiRouteInfo {
                method: "POST",
                path: "/auth/logout",
                auth_required: false,
                description: "Logout current session",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/auth/me",
                auth_required: false,
                description: "Get current session user info",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/api/entries",
                auth_required: true,
                description: "List auth entries",
            },
            ApiRouteInfo {
                method: "POST",
                path: "/api/entries/basic",
                auth_required: true,
                description: "Create basic auth entry",
            },
            ApiRouteInfo {
                method: "POST",
                path: "/api/entries/token",
                auth_required: true,
                description: "Create token auth entry",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/api/entries/{id}",
                auth_required: true,
                description: "Get auth entry by id",
            },
            ApiRouteInfo {
                method: "PUT",
                path: "/api/entries/{id}",
                auth_required: true,
                description: "Update auth entry by id",
            },
            ApiRouteInfo {
                method: "DELETE",
                path: "/api/entries/{id}",
                auth_required: true,
                description: "Delete auth entry by id",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/api/groups",
                auth_required: true,
                description: "List groups",
            },
            ApiRouteInfo {
                method: "POST",
                path: "/api/groups",
                auth_required: true,
                description: "Create group",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/api/groups/{id}",
                auth_required: true,
                description: "Get group by id",
            },
            ApiRouteInfo {
                method: "PUT",
                path: "/api/groups/{id}",
                auth_required: true,
                description: "Update group by id",
            },
            ApiRouteInfo {
                method: "DELETE",
                path: "/api/groups/{id}",
                auth_required: true,
                description: "Delete group by id",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/api/forwardauth/traefik/{group}",
                auth_required: false,
                description: "ForwardAuth endpoint for Traefik",
            },
            ApiRouteInfo {
                method: "GET",
                path: "/api/forwardauth/nginx/{group}",
                auth_required: false,
                description: "ForwardAuth endpoint for Nginx",
            },
        ])
    } else {
        None
    };

    Json(HealthResponse {
        status: "ok",
        service: "securitydept-server",
        apis,
    })
}
