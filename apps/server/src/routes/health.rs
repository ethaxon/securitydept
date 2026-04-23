use axum::{Extension, Json, extract::Query};
use serde::{Deserialize, Serialize};

use crate::state::ServerState;

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
    pub auth_boundary: ApiRouteAuthBoundary,
    pub availability: ApiRouteAvailability,
    pub description: &'static str,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApiRouteAuthBoundary {
    Public,
    Dashboard,
    BasicAuth,
    Protocol,
    ForwardAuth,
    ConditionalPropagation,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApiRouteAvailability {
    Always,
    ConditionalEnabled,
    ConditionalDisabled,
}

#[derive(Debug, Clone, Copy)]
pub struct ApiCatalogCapabilities {
    pub propagation_route_enabled: bool,
}

impl ApiCatalogCapabilities {
    fn from_state(state: &ServerState) -> Self {
        Self {
            propagation_route_enabled: state.propagation_forwarder.is_some(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apis: Option<Vec<ApiRouteInfo>>,
}

pub(crate) fn api_route_catalog(capabilities: ApiCatalogCapabilities) -> Vec<ApiRouteInfo> {
    vec![
        ApiRouteInfo {
            method: "GET",
            path: "/api/health",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Service health and optional API metadata",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/health",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Compatibility alias for service health and API metadata",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/auth/session/login",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Start session login flow or create a dev session when OIDC is disabled",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/auth/session/callback",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Handle the OIDC callback for the session auth flow",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/auth/session/logout",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Clear the current session and logout state",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/auth/session/user-info",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Return the current session user-info projection",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/auth/token-set/backend-mode/login",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Start the stateless token-set backend-mode login flow",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/auth/token-set/backend-mode/callback",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Handle the GET callback for token-set backend mode",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/auth/token-set/backend-mode/callback",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Handle the POST callback for token-set backend mode",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/auth/token-set/backend-mode/refresh",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Refresh stateless token-set backend-mode credentials",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/auth/token-set/backend-mode/metadata/redeem",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Redeem token-set backend-mode metadata by redemption id",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/auth/token-set/backend-mode/user-info",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Exchange backend-mode auth material for user-info",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/api/auth/token-set/frontend-mode/config",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Public,
            availability: ApiRouteAvailability::Always,
            description: "Project browser-owned frontend-mode OIDC config",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/basic/login",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Protocol,
            availability: ApiRouteAvailability::Always,
            description: "Basic Auth login challenge endpoint",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/basic/logout",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::Protocol,
            availability: ApiRouteAvailability::Always,
            description: "Basic Auth logout poison endpoint",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/basic/api/entries",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "List auth entries through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/basic/api/entries/basic",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Create a basic auth entry through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/basic/api/entries/token",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Create a token auth entry through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/basic/api/entries/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Get an auth entry by id through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "PUT",
            path: "/basic/api/entries/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Update an auth entry by id through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "DELETE",
            path: "/basic/api/entries/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Delete an auth entry by id through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/basic/api/groups",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "List groups through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/basic/api/groups",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Create a group through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/basic/api/groups/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Get a group by id through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "PUT",
            path: "/basic/api/groups/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Update a group by id through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "DELETE",
            path: "/basic/api/groups/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::BasicAuth,
            availability: ApiRouteAvailability::Always,
            description: "Delete a group by id through the Basic Auth protected mirror",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/api/entries",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "List auth entries through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/api/entries/basic",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Create a basic auth entry through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/api/entries/token",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Create a token auth entry through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/api/entries/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Get an auth entry by id through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "PUT",
            path: "/api/entries/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Update an auth entry by id through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "DELETE",
            path: "/api/entries/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Delete an auth entry by id through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/api/groups",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "List groups through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "POST",
            path: "/api/groups",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Create a group through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/api/groups/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Get a group by id through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "PUT",
            path: "/api/groups/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Update a group by id through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "DELETE",
            path: "/api/groups/{id}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::Dashboard,
            availability: ApiRouteAvailability::Always,
            description: "Delete a group by id through the dashboard auth boundary",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/api/forwardauth/traefik/{group}",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::ForwardAuth,
            availability: ApiRouteAvailability::Always,
            description: "ForwardAuth endpoint for Traefik",
        },
        ApiRouteInfo {
            method: "GET",
            path: "/api/forwardauth/nginx/{group}",
            auth_required: false,
            auth_boundary: ApiRouteAuthBoundary::ForwardAuth,
            availability: ApiRouteAvailability::Always,
            description: "ForwardAuth endpoint for Nginx",
        },
        ApiRouteInfo {
            method: "ANY",
            path: "/api/propagation/{*rest}",
            auth_required: true,
            auth_boundary: ApiRouteAuthBoundary::ConditionalPropagation,
            availability: if capabilities.propagation_route_enabled {
                ApiRouteAvailability::ConditionalEnabled
            } else {
                ApiRouteAvailability::ConditionalDisabled
            },
            description: "Conditional propagation forwarding route behind the dashboard auth \
                          boundary",
        },
    ]
}

/// GET /api/health (and /health for compatibility)
///
/// Query:
/// - api_details=true: include supported API list
pub async fn health(
    Extension(state): Extension<ServerState>,
    Query(query): Query<HealthQuery>,
) -> Json<HealthResponse> {
    let capabilities = ApiCatalogCapabilities::from_state(&state);
    let apis = if query.api_details {
        Some(api_route_catalog(capabilities))
    } else {
        None
    };

    Json(HealthResponse {
        status: "ok",
        service: "securitydept-server",
        apis,
    })
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use tower::util::ServiceExt;

    use super::*;
    use crate::routes::{build_router, test_support::test_server_state};

    fn find_route<'a>(catalog: &'a [ApiRouteInfo], method: &str, path: &str) -> &'a ApiRouteInfo {
        catalog
            .iter()
            .find(|route| route.method == method && route.path == path)
            .expect("expected route metadata should exist")
    }

    #[test]
    fn api_route_catalog_covers_key_route_families_and_boundaries() {
        let catalog = api_route_catalog(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });

        assert_eq!(
            find_route(&catalog, "GET", "/health").auth_boundary,
            ApiRouteAuthBoundary::Public
        );
        assert_eq!(
            find_route(&catalog, "GET", "/basic/login").auth_boundary,
            ApiRouteAuthBoundary::Protocol
        );
        assert!(find_route(&catalog, "GET", "/basic/api/groups/{id}").auth_required);
        assert_eq!(
            find_route(&catalog, "GET", "/basic/api/groups/{id}").auth_boundary,
            ApiRouteAuthBoundary::BasicAuth
        );
        assert_eq!(
            find_route(&catalog, "POST", "/auth/token-set/backend-mode/user-info").auth_boundary,
            ApiRouteAuthBoundary::Public
        );
        assert_eq!(
            find_route(&catalog, "GET", "/api/forwardauth/nginx/{group}").auth_boundary,
            ApiRouteAuthBoundary::ForwardAuth
        );
    }

    #[test]
    fn api_route_catalog_marks_conditional_propagation_availability() {
        let disabled_catalog = api_route_catalog(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });
        let enabled_catalog = api_route_catalog(ApiCatalogCapabilities {
            propagation_route_enabled: true,
        });

        let disabled = find_route(&disabled_catalog, "ANY", "/api/propagation/{*rest}");
        let enabled = find_route(&enabled_catalog, "ANY", "/api/propagation/{*rest}");

        assert!(disabled.auth_required);
        assert_eq!(
            disabled.auth_boundary,
            ApiRouteAuthBoundary::ConditionalPropagation
        );
        assert_eq!(
            disabled.availability,
            ApiRouteAvailability::ConditionalDisabled
        );
        assert_eq!(
            enabled.availability,
            ApiRouteAvailability::ConditionalEnabled
        );
    }

    #[tokio::test]
    async fn health_alias_and_api_health_return_same_payload() {
        let app = build_router(test_server_state("health-alias").await);

        let api_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("/api/health request should succeed");
        let alias_response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("/health request should succeed");

        assert_eq!(api_response.status(), StatusCode::OK);
        assert_eq!(alias_response.status(), StatusCode::OK);

        let api_body: serde_json::Value = serde_json::from_slice(
            &to_bytes(api_response.into_body(), usize::MAX)
                .await
                .expect("api body should be readable"),
        )
        .expect("api health body should be valid json");
        let alias_body: serde_json::Value = serde_json::from_slice(
            &to_bytes(alias_response.into_body(), usize::MAX)
                .await
                .expect("alias body should be readable"),
        )
        .expect("health alias body should be valid json");

        assert_eq!(api_body, alias_body);
        assert_eq!(api_body["status"], "ok");
        assert_eq!(api_body["service"], "securitydept-server");
    }

    #[tokio::test]
    async fn api_details_response_includes_key_routes_and_serialized_metadata() {
        let app = build_router(test_server_state("health-details").await);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health?api_details=true")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("health details request should succeed");

        assert_eq!(response.status(), StatusCode::OK);

        let body: serde_json::Value = serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("response body should be readable"),
        )
        .expect("health details should be valid json");
        let apis = body["apis"].as_array().expect("apis should be present");

        assert!(apis.iter().any(|route| {
            route["path"] == "/health"
                && route["method"] == "GET"
                && route["auth_boundary"] == "public"
        }));
        assert!(apis.iter().any(|route| {
            route["path"] == "/basic/login"
                && route["auth_boundary"] == "protocol"
                && route["availability"] == "always"
        }));
        assert!(apis.iter().any(|route| {
            route["path"] == "/auth/token-set/backend-mode/user-info"
                && route["method"] == "POST"
                && route["auth_boundary"] == "public"
        }));
        assert!(apis.iter().any(|route| {
            route["path"] == "/basic/api/groups/{id}"
                && route["method"] == "GET"
                && route["auth_boundary"] == "basic_auth"
                && route["auth_required"] == true
        }));
        assert!(apis.iter().any(|route| {
            route["path"] == "/api/propagation/{*rest}"
                && route["method"] == "ANY"
                && route["auth_boundary"] == "conditional_propagation"
                && route["availability"] == "conditional_disabled"
        }));
    }
}
