//! Mounted-route diagnosis & error policy authority.
//!
//! Iteration 149 (Task Pack A + B): owns a single, testable mapping from each
//! mounted route family to:
//!
//! 1. a [`RouteDiagnosisPolicy`] explaining who is responsible for emitting
//!    machine-readable auth-flow diagnosis on that route, and
//! 2. a [`RouteErrorPolicy`] explaining which response shape that route's
//!    failures use (shared `ServerErrorEnvelope`, business not-found,
//!    protocol-specific challenge / poison response, conditional propagation
//!    forwarding, capability catalog, or static fallback).
//!
//! These two tables exist to keep both subjects auditable and prevent
//! regressions like:
//!
//! - introducing a new mounted route without explicitly classifying its
//!   diagnosis owner,
//! - "unifying" a Basic-Auth challenge or logout poison response into the
//!   shared error envelope and breaking the protocol contract,
//! - rewriting `/api/propagation/{*rest}` failures as route-local
//!   `service_unavailable` and discarding the underlying status / presentation,
//! - retrofitting backend-mode `metadata/redeem` business not-found into a
//!   shared envelope failure.
//!
//! This module is deliberately not OpenAPI / schema registry / OTel exporter.
//! It only enumerates the small set of mounted route families that
//! [`crate::routes::build_router`] actually wires.

#![allow(dead_code)]
// The classification helpers, public policy projections, and the auth-flow
// operation roster exist primarily as a testable authority surface; they are
// only consumed by `policy::tests` and not by the runtime router.

use securitydept_core::utils::observability::AuthFlowOperation;

use crate::routes::health::{ApiCatalogCapabilities, api_route_catalog};

/// Pseudo-path used in the policy tables to represent the static webui
/// fallback service. The real router does not register a route under this
/// path; the entry exists so the policy table can explicitly record that the
/// static fallback is intentionally outside the auth-flow diagnosis baseline.
pub const STATIC_FALLBACK_POLICY_PATH: &str = "<static-webui-fallback>";

/// Who is responsible for emitting auth-flow diagnosis on a mounted route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteDiagnosisPolicy {
    /// The route handler emits a machine-readable [`AuthFlowOperation`]
    /// diagnosis on the request.
    Diagnosed,
    /// The auth boundary middleware emits the boundary-level diagnosis;
    /// the handler is reused from another diagnosed route family and the
    /// middleware is the authoritative diagnosis owner for this mount point.
    MiddlewareDiagnosed,
    /// The route preserves a protocol-specific response (Basic-Auth
    /// challenge, logout poison, ForwardAuth challenge) and is deliberately
    /// not folded into the shared auth-flow diagnosis baseline as an
    /// ordinary failure. The route may still emit a diagnosis, but its
    /// observable response shape is owned by the protocol contract.
    ProtocolException,
    /// Capability metadata endpoint (route catalog, health) that is not an
    /// auth-flow operation and intentionally does not pretend to be one.
    CapabilityCatalog,
    /// Static webui asset serving via fallback `ServeDir`. Never enters
    /// the auth-flow diagnosis baseline.
    StaticFallback,
}

/// One row of the mounted-route diagnosis policy table.
#[derive(Debug, Clone, Copy)]
pub struct RouteDiagnosisEntry {
    pub method: &'static str,
    pub path: &'static str,
    pub policy: RouteDiagnosisPolicy,
    /// Shared [`AuthFlowOperation`] constant the route or its boundary
    /// middleware reports. `None` for `CapabilityCatalog` and
    /// `StaticFallback` because those routes are not auth-flow operations.
    pub operation: Option<&'static str>,
}

/// Which response shape a mounted route's failures use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteErrorPolicy {
    /// Ordinary `ServerError` failures rendered through
    /// [`securitydept_core::utils::error::ServerErrorEnvelope`] with stable
    /// `error.kind` / `error.code` / `error.recovery` /
    /// `error.presentation`.
    SharedEnvelope,
    /// Business not-found whose absence is part of the contract (currently
    /// backend-mode `metadata/redeem` returning `None -> 404`). Stays a
    /// plain `404` body without the shared envelope to keep the business
    /// semantics distinct from a server failure.
    BusinessNotFound,
    /// Protocol-specific `401` challenge that must keep `WWW-Authenticate`
    /// (Basic-Auth login, ForwardAuth Traefik / Nginx). Wrapping these
    /// in the shared envelope would break the browser-native or proxy
    /// contract.
    ProtocolChallengeException,
    /// Basic-Auth logout poison response. Returns plain `401` without a
    /// fresh challenge so that the browser drops the cached credential.
    ProtocolPoisonException,
    /// Conditional propagation forwarding: failures preserve the
    /// underlying upstream status / presentation through
    /// `ServerError::from(error)` instead of being rewritten to a
    /// route-local generic message.
    ConditionalPropagationPreserveUnderlying,
    /// Basic-Auth protected mirror under `/basic/api/*`. The route
    /// handlers themselves are reused from the dashboard creds-manage
    /// surface (whose ordinary failures use [`SharedEnvelope`]), but the
    /// Basic-Auth boundary middleware short-circuits unauthorized
    /// requests with a plain `401` `BasicAuthProtocolResponse` instead
    /// of the shared envelope. Recording this as its own policy keeps
    /// the mirror's protocol boundary explicit and prevents the
    /// unauthorized response shape from being retrofitted back into
    /// `SharedEnvelope`.
    BasicAuthMirrorUnauthorized,
    /// Capability metadata endpoint (`/api/health`, `/health`); never
    /// returns an envelope failure under normal operation.
    CapabilityCatalog,
    /// Static webui asset serving; failures come from the underlying
    /// `ServeDir` / `ServeFile` services, not from the application error
    /// envelope.
    StaticFallback,
}

/// One row of the mounted-route error policy table.
#[derive(Debug, Clone, Copy)]
pub struct RouteErrorEntry {
    pub method: &'static str,
    pub path: &'static str,
    pub policy: RouteErrorPolicy,
}

fn classify_diagnosis(method: &str, path: &str) -> (RouteDiagnosisPolicy, Option<&'static str>) {
    match (method, path) {
        ("GET", "/api/health") | ("GET", "/health") => (RouteDiagnosisPolicy::CapabilityCatalog, None),

        ("GET", "/auth/session/login") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::SESSION_LOGIN))
        }
        ("GET", "/auth/session/callback") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::OIDC_CALLBACK))
        }
        ("POST", "/auth/session/logout") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::SESSION_LOGOUT))
        }
        ("GET", "/auth/session/user-info") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::SESSION_USER_INFO))
        }

        ("GET", "/auth/token-set/backend-mode/login") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::OIDC_AUTHORIZE))
        }
        ("GET", "/auth/token-set/backend-mode/callback")
        | ("POST", "/auth/token-set/backend-mode/callback") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::OIDC_CALLBACK))
        }
        ("POST", "/auth/token-set/backend-mode/refresh") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::OIDC_TOKEN_REFRESH))
        }
        ("POST", "/auth/token-set/backend-mode/metadata/redeem") => (
            RouteDiagnosisPolicy::Diagnosed,
            Some(AuthFlowOperation::OIDC_METADATA_REDEEM),
        ),
        ("POST", "/auth/token-set/backend-mode/user-info") => {
            (RouteDiagnosisPolicy::Diagnosed, Some(AuthFlowOperation::OIDC_USER_INFO))
        }

        ("GET", "/api/auth/token-set/frontend-mode/config") => (
            RouteDiagnosisPolicy::Diagnosed,
            Some(AuthFlowOperation::PROJECTION_CONFIG_FETCH),
        ),

        ("GET", "/basic/login") => (
            RouteDiagnosisPolicy::ProtocolException,
            Some(AuthFlowOperation::BASIC_AUTH_LOGIN),
        ),
        ("POST", "/basic/logout") => (
            RouteDiagnosisPolicy::ProtocolException,
            Some(AuthFlowOperation::BASIC_AUTH_LOGOUT),
        ),

        ("GET", "/api/forwardauth/traefik/{group}")
        | ("GET", "/api/forwardauth/nginx/{group}") => (
            RouteDiagnosisPolicy::ProtocolException,
            Some(AuthFlowOperation::FORWARD_AUTH_CHECK),
        ),

        ("ANY", "/api/propagation/{*rest}") => (
            RouteDiagnosisPolicy::Diagnosed,
            Some(AuthFlowOperation::PROPAGATION_FORWARD),
        ),

        // /basic/api/* mirrors the creds-manage handlers but the dominant
        // diagnosis on this mount point is the Basic-Auth boundary
        // middleware (BASIC_AUTH_AUTHORIZE). The handler diagnoses are
        // auxiliary inner-operation evidence.
        (_, p) if p.starts_with("/basic/api/") => (
            RouteDiagnosisPolicy::MiddlewareDiagnosed,
            Some(AuthFlowOperation::BASIC_AUTH_AUTHORIZE),
        ),

        // Dashboard-protected creds-manage routes.
        ("GET", "/api/entries") | (_, "/api/entries/basic") | (_, "/api/entries/token") => {
            classify_creds_entry(method, path)
        }
        (_, p) if p.starts_with("/api/entries/") => classify_creds_entry(method, path),
        (_, "/api/groups") => classify_creds_group(method, path),
        (_, p) if p.starts_with("/api/groups/") => classify_creds_group(method, path),

        _ => unreachable!("unclassified mounted route family: {method} {path}"),
    }
}

fn classify_creds_entry(method: &str, path: &str) -> (RouteDiagnosisPolicy, Option<&'static str>) {
    let op = match (method, path) {
        ("GET", "/api/entries") => AuthFlowOperation::CREDS_MANAGE_ENTRY_LIST,
        ("GET", _) => AuthFlowOperation::CREDS_MANAGE_ENTRY_GET,
        ("POST", "/api/entries/basic") => AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_BASIC,
        ("POST", "/api/entries/token") => AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_TOKEN,
        ("PUT", _) => AuthFlowOperation::CREDS_MANAGE_ENTRY_UPDATE,
        ("DELETE", _) => AuthFlowOperation::CREDS_MANAGE_ENTRY_DELETE,
        _ => unreachable!("unclassified creds-manage entry route: {method} {path}"),
    };
    (RouteDiagnosisPolicy::Diagnosed, Some(op))
}

fn classify_creds_group(method: &str, path: &str) -> (RouteDiagnosisPolicy, Option<&'static str>) {
    let op = match (method, path) {
        ("GET", "/api/groups") => AuthFlowOperation::CREDS_MANAGE_GROUP_LIST,
        ("GET", _) => AuthFlowOperation::CREDS_MANAGE_GROUP_GET,
        ("POST", "/api/groups") => AuthFlowOperation::CREDS_MANAGE_GROUP_CREATE,
        ("PUT", _) => AuthFlowOperation::CREDS_MANAGE_GROUP_UPDATE,
        ("DELETE", _) => AuthFlowOperation::CREDS_MANAGE_GROUP_DELETE,
        _ => unreachable!("unclassified creds-manage group route: {method} {path}"),
    };
    (RouteDiagnosisPolicy::Diagnosed, Some(op))
}

fn classify_error(method: &str, path: &str) -> RouteErrorPolicy {
    match (method, path) {
        ("GET", "/api/health") | ("GET", "/health") => RouteErrorPolicy::CapabilityCatalog,
        ("GET", "/basic/login") => RouteErrorPolicy::ProtocolChallengeException,
        ("POST", "/basic/logout") => RouteErrorPolicy::ProtocolPoisonException,
        ("GET", "/api/forwardauth/traefik/{group}")
        | ("GET", "/api/forwardauth/nginx/{group}") => RouteErrorPolicy::ProtocolChallengeException,
        ("POST", "/auth/token-set/backend-mode/metadata/redeem") => {
            RouteErrorPolicy::BusinessNotFound
        }
        ("ANY", "/api/propagation/{*rest}") => {
            RouteErrorPolicy::ConditionalPropagationPreserveUnderlying
        }
        // Basic-Auth protected mirror routes are gated by the
        // `require_basic_auth()` middleware. When credentials are
        // missing or rejected the boundary returns a plain Basic-Auth
        // protocol `401`, NOT the shared envelope. The handlers behind
        // the mirror still produce shared-envelope failures for inner
        // operations once the boundary admits the request, but the
        // primary policy-visible failure on this mount point is the
        // protocol-shaped unauthorized response.
        (_, p) if p.starts_with("/basic/api/") => RouteErrorPolicy::BasicAuthMirrorUnauthorized,
        _ => RouteErrorPolicy::SharedEnvelope,
    }
}

/// Build the mounted-route diagnosis policy table for the given catalog
/// capability flags.
pub fn route_diagnosis_policy(capabilities: ApiCatalogCapabilities) -> Vec<RouteDiagnosisEntry> {
    let mut entries: Vec<RouteDiagnosisEntry> = api_route_catalog(capabilities)
        .into_iter()
        .map(|route| {
            let (policy, operation) = classify_diagnosis(route.method, route.path);
            RouteDiagnosisEntry {
                method: route.method,
                path: route.path,
                policy,
                operation,
            }
        })
        .collect();

    entries.push(RouteDiagnosisEntry {
        method: "GET",
        path: STATIC_FALLBACK_POLICY_PATH,
        policy: RouteDiagnosisPolicy::StaticFallback,
        operation: None,
    });

    entries
}

/// Build the mounted-route error policy table for the given catalog
/// capability flags.
pub fn route_error_policy(capabilities: ApiCatalogCapabilities) -> Vec<RouteErrorEntry> {
    let mut entries: Vec<RouteErrorEntry> = api_route_catalog(capabilities)
        .into_iter()
        .map(|route| RouteErrorEntry {
            method: route.method,
            path: route.path,
            policy: classify_error(route.method, route.path),
        })
        .collect();

    entries.push(RouteErrorEntry {
        method: "GET",
        path: STATIC_FALLBACK_POLICY_PATH,
        policy: RouteErrorPolicy::StaticFallback,
    });

    entries
}

/// Set of every [`AuthFlowOperation`] constant currently published by
/// `securitydept-utils::observability`. The diagnosis policy tests assert
/// that every diagnosed route entry's operation belongs to this set so a
/// future routing change cannot quietly introduce a bare-string operation.
fn known_auth_flow_operations() -> &'static [&'static str] {
    &[
        AuthFlowOperation::PROJECTION_CONFIG_FETCH,
        AuthFlowOperation::OIDC_AUTHORIZE,
        AuthFlowOperation::OIDC_CALLBACK,
        AuthFlowOperation::OIDC_METADATA_REDEEM,
        AuthFlowOperation::OIDC_TOKEN_REFRESH,
        AuthFlowOperation::OIDC_USER_INFO,
        AuthFlowOperation::FORWARD_AUTH_CHECK,
        AuthFlowOperation::PROPAGATION_FORWARD,
        AuthFlowOperation::BASIC_AUTH_LOGIN,
        AuthFlowOperation::BASIC_AUTH_LOGOUT,
        AuthFlowOperation::BASIC_AUTH_AUTHORIZE,
        AuthFlowOperation::SESSION_LOGIN,
        AuthFlowOperation::SESSION_LOGOUT,
        AuthFlowOperation::SESSION_USER_INFO,
        AuthFlowOperation::DASHBOARD_AUTH_CHECK,
        AuthFlowOperation::CREDS_MANAGE_GROUP_LIST,
        AuthFlowOperation::CREDS_MANAGE_GROUP_GET,
        AuthFlowOperation::CREDS_MANAGE_GROUP_CREATE,
        AuthFlowOperation::CREDS_MANAGE_GROUP_UPDATE,
        AuthFlowOperation::CREDS_MANAGE_GROUP_DELETE,
        AuthFlowOperation::CREDS_MANAGE_ENTRY_LIST,
        AuthFlowOperation::CREDS_MANAGE_ENTRY_GET,
        AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_BASIC,
        AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_TOKEN,
        AuthFlowOperation::CREDS_MANAGE_ENTRY_UPDATE,
        AuthFlowOperation::CREDS_MANAGE_ENTRY_DELETE,
    ]
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header},
    };
    use tower::util::ServiceExt;

    use super::*;
    use crate::routes::{
        build_router,
        health::{ApiRouteAuthBoundary, api_route_catalog},
        test_support::test_server_state,
    };

    fn find_diag<'a>(
        entries: &'a [RouteDiagnosisEntry],
        method: &str,
        path: &str,
    ) -> &'a RouteDiagnosisEntry {
        entries
            .iter()
            .find(|entry| entry.method == method && entry.path == path)
            .unwrap_or_else(|| panic!("expected diagnosis entry for {method} {path}"))
    }

    fn find_err<'a>(
        entries: &'a [RouteErrorEntry],
        method: &str,
        path: &str,
    ) -> &'a RouteErrorEntry {
        entries
            .iter()
            .find(|entry| entry.method == method && entry.path == path)
            .unwrap_or_else(|| panic!("expected error policy entry for {method} {path}"))
    }

    #[test]
    fn diagnosis_policy_covers_every_mounted_route_in_the_catalog() {
        let capabilities = ApiCatalogCapabilities {
            propagation_route_enabled: true,
        };
        let catalog = api_route_catalog(capabilities);
        let entries = route_diagnosis_policy(capabilities);

        for route in &catalog {
            let entry = find_diag(&entries, route.method, route.path);
            // The catalog is the upstream authority for what is mounted.
            // The policy table must mirror it so that adding a route
            // without classifying its diagnosis owner is a compile-or-test
            // failure here.
            assert_eq!(entry.method, route.method);
            assert_eq!(entry.path, route.path);
        }

        // Static fallback is recorded as deliberate non-auth-flow surface.
        let static_entry = find_diag(&entries, "GET", STATIC_FALLBACK_POLICY_PATH);
        assert_eq!(static_entry.policy, RouteDiagnosisPolicy::StaticFallback);
        assert!(static_entry.operation.is_none());
    }

    #[test]
    fn diagnosed_entries_point_to_known_auth_flow_operations() {
        let entries = route_diagnosis_policy(ApiCatalogCapabilities {
            propagation_route_enabled: true,
        });
        let known = known_auth_flow_operations();

        for entry in &entries {
            match entry.policy {
                RouteDiagnosisPolicy::Diagnosed
                | RouteDiagnosisPolicy::MiddlewareDiagnosed
                | RouteDiagnosisPolicy::ProtocolException => {
                    let op = entry
                        .operation
                        .unwrap_or_else(|| panic!("policy {:?} requires an operation: {} {}", entry.policy, entry.method, entry.path));
                    assert!(
                        known.contains(&op),
                        "operation {op:?} for {} {} is not a published AuthFlowOperation constant",
                        entry.method,
                        entry.path,
                    );
                }
                RouteDiagnosisPolicy::CapabilityCatalog
                | RouteDiagnosisPolicy::StaticFallback => {
                    assert!(
                        entry.operation.is_none(),
                        "{:?} entries must not pretend to be an auth-flow operation: {} {}",
                        entry.policy,
                        entry.method,
                        entry.path,
                    );
                }
            }
        }
    }

    #[test]
    fn health_routes_are_capability_catalog_not_auth_flow() {
        let entries = route_diagnosis_policy(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });

        for path in ["/api/health", "/health"] {
            let entry = find_diag(&entries, "GET", path);
            assert_eq!(
                entry.policy,
                RouteDiagnosisPolicy::CapabilityCatalog,
                "{path} must be classified as capability-catalog, not an auth-flow operation"
            );
            assert!(entry.operation.is_none());
        }
    }

    #[test]
    fn protocol_exception_routes_are_explicit_and_keep_their_operation() {
        let entries = route_diagnosis_policy(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });

        let basic_login = find_diag(&entries, "GET", "/basic/login");
        assert_eq!(basic_login.policy, RouteDiagnosisPolicy::ProtocolException);
        assert_eq!(basic_login.operation, Some(AuthFlowOperation::BASIC_AUTH_LOGIN));

        let basic_logout = find_diag(&entries, "POST", "/basic/logout");
        assert_eq!(basic_logout.policy, RouteDiagnosisPolicy::ProtocolException);
        assert_eq!(basic_logout.operation, Some(AuthFlowOperation::BASIC_AUTH_LOGOUT));

        for path in [
            "/api/forwardauth/traefik/{group}",
            "/api/forwardauth/nginx/{group}",
        ] {
            let fa = find_diag(&entries, "GET", path);
            assert_eq!(fa.policy, RouteDiagnosisPolicy::ProtocolException);
            assert_eq!(fa.operation, Some(AuthFlowOperation::FORWARD_AUTH_CHECK));
        }
    }

    #[test]
    fn basic_api_mirror_is_middleware_diagnosed_under_basic_auth_boundary() {
        let entries = route_diagnosis_policy(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });

        let basic_groups = find_diag(&entries, "GET", "/basic/api/groups/{id}");
        assert_eq!(
            basic_groups.policy,
            RouteDiagnosisPolicy::MiddlewareDiagnosed
        );
        assert_eq!(
            basic_groups.operation,
            Some(AuthFlowOperation::BASIC_AUTH_AUTHORIZE)
        );
    }

    #[test]
    fn dashboard_creds_manage_routes_are_handler_diagnosed() {
        let entries = route_diagnosis_policy(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });

        let groups_get = find_diag(&entries, "GET", "/api/groups/{id}");
        assert_eq!(groups_get.policy, RouteDiagnosisPolicy::Diagnosed);
        assert_eq!(
            groups_get.operation,
            Some(AuthFlowOperation::CREDS_MANAGE_GROUP_GET)
        );

        let entry_create = find_diag(&entries, "POST", "/api/entries/basic");
        assert_eq!(entry_create.policy, RouteDiagnosisPolicy::Diagnosed);
        assert_eq!(
            entry_create.operation,
            Some(AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_BASIC)
        );
    }

    #[test]
    fn propagation_route_is_diagnosed_with_propagation_forward_operation() {
        let entries = route_diagnosis_policy(ApiCatalogCapabilities {
            propagation_route_enabled: true,
        });
        let propagation = find_diag(&entries, "ANY", "/api/propagation/{*rest}");
        assert_eq!(propagation.policy, RouteDiagnosisPolicy::Diagnosed);
        assert_eq!(
            propagation.operation,
            Some(AuthFlowOperation::PROPAGATION_FORWARD)
        );
    }

    #[test]
    fn diagnosis_policy_distribution_matches_authority_boundaries() {
        let entries = route_diagnosis_policy(ApiCatalogCapabilities {
            propagation_route_enabled: true,
        });

        // ApiRouteAuthBoundary is the upstream authority on which boundary
        // a route lives behind; cross-check the two tables agree on a few
        // representative families so a future change to the boundary
        // catalog cannot silently desynchronize the policy classification.
        let catalog = api_route_catalog(ApiCatalogCapabilities {
            propagation_route_enabled: true,
        });
        for route in &catalog {
            let entry = find_diag(&entries, route.method, route.path);
            match route.auth_boundary {
                ApiRouteAuthBoundary::Public if route.path.starts_with("/auth/") => {
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::Diagnosed);
                }
                ApiRouteAuthBoundary::Public if route.path.starts_with("/api/auth/") => {
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::Diagnosed);
                }
                ApiRouteAuthBoundary::ForwardAuth => {
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::ProtocolException);
                }
                ApiRouteAuthBoundary::Protocol => {
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::ProtocolException);
                }
                ApiRouteAuthBoundary::BasicAuth => {
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::MiddlewareDiagnosed);
                }
                ApiRouteAuthBoundary::Dashboard => {
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::Diagnosed);
                }
                ApiRouteAuthBoundary::ConditionalPropagation => {
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::Diagnosed);
                }
                ApiRouteAuthBoundary::Public => {
                    // /api/health and /health: capability catalog.
                    assert_eq!(entry.policy, RouteDiagnosisPolicy::CapabilityCatalog);
                }
            }
        }
    }

    // ---------- Task Pack B: route error policy matrix ----------

    #[test]
    fn error_policy_covers_every_mounted_route_in_the_catalog() {
        let capabilities = ApiCatalogCapabilities {
            propagation_route_enabled: true,
        };
        let catalog = api_route_catalog(capabilities);
        let entries = route_error_policy(capabilities);

        for route in &catalog {
            let _entry = find_err(&entries, route.method, route.path);
        }

        let static_entry = find_err(&entries, "GET", STATIC_FALLBACK_POLICY_PATH);
        assert_eq!(static_entry.policy, RouteErrorPolicy::StaticFallback);
    }

    #[test]
    fn error_policy_locks_protocol_exceptions_and_business_not_found() {
        let entries = route_error_policy(ApiCatalogCapabilities {
            propagation_route_enabled: true,
        });

        assert_eq!(
            find_err(&entries, "GET", "/basic/login").policy,
            RouteErrorPolicy::ProtocolChallengeException,
        );
        assert_eq!(
            find_err(&entries, "POST", "/basic/logout").policy,
            RouteErrorPolicy::ProtocolPoisonException,
        );
        assert_eq!(
            find_err(&entries, "GET", "/api/forwardauth/traefik/{group}").policy,
            RouteErrorPolicy::ProtocolChallengeException,
        );
        assert_eq!(
            find_err(&entries, "GET", "/api/forwardauth/nginx/{group}").policy,
            RouteErrorPolicy::ProtocolChallengeException,
        );
        assert_eq!(
            find_err(
                &entries,
                "POST",
                "/auth/token-set/backend-mode/metadata/redeem"
            )
            .policy,
            RouteErrorPolicy::BusinessNotFound,
        );
        assert_eq!(
            find_err(&entries, "ANY", "/api/propagation/{*rest}").policy,
            RouteErrorPolicy::ConditionalPropagationPreserveUnderlying,
        );

        // Basic-Auth protected mirror routes are gated by the boundary
        // middleware, which short-circuits unauthorized requests with a
        // plain Basic-Auth protocol 401. They must NOT fall through to
        // the shared envelope policy.
        for (method, path) in [
            ("GET", "/basic/api/groups"),
            ("GET", "/basic/api/groups/{id}"),
            ("POST", "/basic/api/groups"),
            ("PUT", "/basic/api/groups/{id}"),
            ("DELETE", "/basic/api/groups/{id}"),
            ("GET", "/basic/api/entries"),
            ("GET", "/basic/api/entries/{id}"),
            ("POST", "/basic/api/entries/basic"),
            ("POST", "/basic/api/entries/token"),
            ("PUT", "/basic/api/entries/{id}"),
            ("DELETE", "/basic/api/entries/{id}"),
        ] {
            assert_eq!(
                find_err(&entries, method, path).policy,
                RouteErrorPolicy::BasicAuthMirrorUnauthorized,
                "{method} {path} must be classified as Basic-Auth mirror unauthorized, not shared envelope",
            );
        }

        // Representative shared-envelope routes.
        for (method, path) in [
            ("GET", "/api/auth/token-set/frontend-mode/config"),
            ("GET", "/api/groups"),
            ("POST", "/api/entries/basic"),
            ("POST", "/auth/token-set/backend-mode/user-info"),
            ("POST", "/auth/token-set/backend-mode/refresh"),
        ] {
            assert_eq!(
                find_err(&entries, method, path).policy,
                RouteErrorPolicy::SharedEnvelope,
                "{method} {path} must be classified as shared envelope",
            );
        }
    }

    #[test]
    fn error_policy_health_is_capability_catalog() {
        let entries = route_error_policy(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });
        for path in ["/api/health", "/health"] {
            assert_eq!(
                find_err(&entries, "GET", path).policy,
                RouteErrorPolicy::CapabilityCatalog,
            );
        }
    }

    // ---------- Behavioral guardrails on the live router ----------

    #[tokio::test]
    async fn ordinary_route_failure_returns_shared_server_error_envelope() {
        // Frontend-mode config projection requires the frontend OIDC
        // runtime; the test server state intentionally has it disabled,
        // so the route returns the shared envelope instead of a
        // protocol-specific or route-local error shape.
        let app = build_router(test_server_state("policy-shared-envelope").await);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/auth/token-set/frontend-mode/config")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("frontend-mode config request should be served");

        assert!(response.status().is_server_error() || response.status().is_client_error());
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .expect("shared envelope must set a content type"),
            "application/json",
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("envelope body should be readable");
        let envelope: serde_json::Value =
            serde_json::from_slice(&body).expect("envelope should be valid json");
        assert_eq!(envelope["success"], false);
        assert!(envelope["status"].as_u64().is_some());
        assert!(envelope["error"]["kind"].is_string());
        assert!(envelope["error"]["code"].is_string());
        assert!(envelope["error"]["recovery"].is_string());
        assert!(envelope["error"]["presentation"]["code"].is_string());
        assert!(envelope["error"]["presentation"]["recovery"].is_string());
    }

    #[tokio::test]
    async fn basic_auth_logout_poison_is_not_wrapped_in_envelope() {
        let app = build_router(test_server_state("policy-basic-poison").await);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/basic/logout")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("basic logout request should be served");

        // Logout poison contract: plain 401 without WWW-Authenticate so the
        // browser drops the cached credential, and never the shared
        // application/json error envelope.
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(
            response.headers().get("www-authenticate").is_none(),
            "Basic-Auth logout poison must NOT advertise a fresh challenge",
        );
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .map(|v| v.to_str().unwrap_or("").to_string())
            .unwrap_or_default();
        assert!(
            !content_type.starts_with("application/json"),
            "Basic-Auth logout poison must not be served as application/json envelope (got {content_type:?})",
        );
    }

    #[tokio::test]
    async fn forward_auth_unauthorized_keeps_protocol_challenge_shape() {
        let app = build_router(test_server_state("policy-forward-auth").await);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/forwardauth/traefik/unknown-group")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("forward-auth request should be served");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(
            response.headers().get("www-authenticate").is_some(),
            "ForwardAuth 401 must keep WWW-Authenticate header",
        );
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .map(|v| v.to_str().unwrap_or("").to_string())
            .unwrap_or_default();
        assert!(
            !content_type.starts_with("application/json"),
            "ForwardAuth challenge must not be wrapped in shared envelope (got {content_type:?})",
        );
    }

    #[tokio::test]
    async fn metadata_redeem_unknown_id_stays_plain_business_not_found() {
        // The handler unit test in `routes::auth::token_set_backend_mode`
        // (`metadata_not_found_response_stays_plain_business_response`)
        // already proves the `None -> 404` business contract. Here we
        // assert the live router still routes the path, and that the
        // upstream contract (no JSON envelope, no body on the not-found
        // response shape) holds at the policy boundary by reusing the
        // policy classification: any future change that reroutes
        // metadata redeem into the shared envelope would also need to
        // flip this entry.
        let entries = route_error_policy(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });
        let metadata = find_err(
            &entries,
            "POST",
            "/auth/token-set/backend-mode/metadata/redeem",
        );
        assert_eq!(metadata.policy, RouteErrorPolicy::BusinessNotFound);
    }

    #[tokio::test]
    async fn basic_auth_mirror_without_credentials_returns_plain_protocol_401_not_envelope() {
        // Live-router regression for Finding 1 (iteration 149 review 1):
        // /basic/api/* is gated by the Basic-Auth boundary middleware. A
        // request with no Authorization header must be short-circuited
        // by the middleware as a plain Basic-Auth protocol 401 (no
        // shared application/json envelope, no `WWW-Authenticate` since
        // this is the protected mirror, not the explicit /basic/login
        // challenge). This assertion locks the policy classification
        // (`BasicAuthMirrorUnauthorized`) to the live response shape so
        // a future routing change cannot quietly retrofit this path
        // back into the shared-envelope baseline.
        use axum::extract::ConnectInfo;
        use std::net::{IpAddr, Ipv4Addr, SocketAddr};

        let app = build_router(test_server_state("policy-basic-mirror").await);
        let mut request = Request::builder()
            .uri("/basic/api/groups")
            .body(Body::empty())
            .expect("request should build");
        request.extensions_mut().insert(ConnectInfo(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            65000,
        )));
        let response = app
            .oneshot(request)
            .await
            .expect("basic mirror request should be served");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .map(|v| v.to_str().unwrap_or("").to_string())
            .unwrap_or_default();
        assert!(
            !content_type.starts_with("application/json"),
            "Basic-Auth mirror unauthorized must not be wrapped in shared envelope (got {content_type:?})",
        );

        let entries = route_error_policy(ApiCatalogCapabilities {
            propagation_route_enabled: false,
        });
        for (method, path) in [
            ("GET", "/basic/api/groups"),
            ("POST", "/basic/api/entries/basic"),
        ] {
            assert_eq!(
                find_err(&entries, method, path).policy,
                RouteErrorPolicy::BasicAuthMirrorUnauthorized,
            );
        }
    }
}
