use securitydept_creds::{CoreJwtClaims, parse_bearer_auth_header_opt};
use securitydept_oauth_resource_server::{
    OAuthResourceServerError, OAuthResourceServerVerifier, ResourceTokenPrincipal,
};
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
    observability::{
        AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowDiagnosisOutcome, AuthFlowOperation,
        DiagnosedResult,
    },
};
use snafu::Snafu;

use super::{
    forwarder::{PropagationForwarder, PropagationForwarderError},
    propagation::{
        DEFAULT_PROPAGATION_HEADER_NAME, PropagatedBearer, PropagationDirective,
        PropagationRequestTarget, TokenPropagatorError,
    },
    runtime::AccessTokenSubstrateRuntime,
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/// Errors produced by [`AccessTokenSubstrateResourceService`].
#[derive(Debug, Snafu)]
pub enum AccessTokenSubstrateResourceServiceError {
    #[snafu(transparent)]
    OAuthResourceServer { source: OAuthResourceServerError },

    #[snafu(transparent)]
    Propagation { source: PropagationForwarderError },

    #[snafu(display("token propagation is not enabled on this server"))]
    PropagationNotEnabled,

    #[snafu(display("propagation request requires a bearer token in the Authorization header"))]
    BearerTokenRequired,

    #[snafu(display("propagation request requires the {DEFAULT_PROPAGATION_HEADER_NAME} header"))]
    PropagationDirectiveRequired,

    #[snafu(display("invalid propagation directive: {source}"))]
    PropagationDirectiveInvalid { source: TokenPropagatorError },
}

impl ToHttpStatus for AccessTokenSubstrateResourceServiceError {
    fn to_http_status(&self) -> http::StatusCode {
        match self {
            Self::OAuthResourceServer { source } => source.to_http_status(),
            Self::BearerTokenRequired
            | Self::PropagationDirectiveRequired
            | Self::PropagationDirectiveInvalid { .. } => http::StatusCode::BAD_REQUEST,
            Self::Propagation { .. } | Self::PropagationNotEnabled => {
                http::StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }
}

impl ToErrorPresentation for AccessTokenSubstrateResourceServiceError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::OAuthResourceServer { source } => source.to_error_presentation(),
            Self::Propagation { source } => source.to_error_presentation(),
            Self::PropagationNotEnabled => ErrorPresentation::new(
                "propagation_not_enabled",
                "Token propagation is not enabled on this server.",
                UserRecovery::ContactSupport,
            ),
            Self::BearerTokenRequired => ErrorPresentation::new(
                "bearer_token_required",
                "A bearer token in the Authorization header is required for propagation.",
                UserRecovery::Reauthenticate,
            ),
            Self::PropagationDirectiveRequired => ErrorPresentation::new(
                "propagation_directive_required",
                "The propagation directive header is required.",
                UserRecovery::ContactSupport,
            ),
            Self::PropagationDirectiveInvalid { .. } => ErrorPresentation::new(
                "propagation_directive_invalid",
                "The propagation directive header is malformed.",
                UserRecovery::ContactSupport,
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// Cross-mode resource service for verifying bearer tokens and forwarding
/// propagation requests.
///
/// # Capabilities
///
/// | Method | Description |
/// |---|---|
/// | [`authenticate_authorization_header`](Self::authenticate_authorization_header) | Verify a bearer token from an `Authorization` header |
/// | [`parse_propagation_directive`](Self::parse_propagation_directive) | Extract and parse the propagation directive from request headers |
/// | [`propagate_request`](Self::propagate_request) | End-to-end: extract bearer + directive from request, verify, and forward |
/// | [`propagate_bearer`](Self::propagate_bearer) | Low-level: forward a pre-extracted bearer to a downstream target |
///
/// # Service pattern
///
/// Constructed from `ServerState` via `resource_service()` when both
/// `substrate_runtime` and `oauth_resource_server_verifier` are present,
/// mirroring [`BackendOidcModeAuthService`](crate::backend_oidc_mode::BackendOidcModeAuthService).
#[derive(Clone, Copy)]
pub struct AccessTokenSubstrateResourceService<'a> {
    runtime: &'a AccessTokenSubstrateRuntime,
    verifier: &'a OAuthResourceServerVerifier,
}

impl<'a> AccessTokenSubstrateResourceService<'a> {
    pub fn new(
        runtime: &'a AccessTokenSubstrateRuntime,
        verifier: &'a OAuthResourceServerVerifier,
    ) -> Self {
        Self { runtime, verifier }
    }

    // -----------------------------------------------------------------------
    // Token verification
    // -----------------------------------------------------------------------

    /// Verify a bearer token extracted from an `Authorization` header.
    ///
    /// Returns `None` when the header is absent or not a bearer token.
    pub async fn authenticate_authorization_header(
        &self,
        authorization_header: Option<&str>,
    ) -> Result<Option<ResourceTokenPrincipal>, AccessTokenSubstrateResourceServiceError> {
        let Some(authorization_header) = authorization_header else {
            return Ok(None);
        };
        let Some(token) = parse_bearer_auth_header_opt(authorization_header) else {
            return Ok(None);
        };

        let verified = self
            .verifier
            .verify_token::<CoreJwtClaims>(&token)
            .await
            .map_err(
                |source| AccessTokenSubstrateResourceServiceError::OAuthResourceServer { source },
            )?;

        Ok(Some(verified.to_resource_token_principal()))
    }

    // -----------------------------------------------------------------------
    // Propagation directive parsing
    // -----------------------------------------------------------------------

    /// Extract and parse a [`PropagationDirective`] from request headers.
    ///
    /// Returns `Ok(None)` when the `x-securitydept-propagation` header is
    /// absent, `Ok(Some(directive))` when present and valid, or
    /// [`PropagationDirectiveInvalid`](AccessTokenSubstrateResourceServiceError::PropagationDirectiveInvalid)
    /// when the header value is malformed.
    pub fn parse_propagation_directive(
        headers: &http::HeaderMap,
    ) -> Result<Option<PropagationDirective>, AccessTokenSubstrateResourceServiceError> {
        let Some(value) = headers.get(DEFAULT_PROPAGATION_HEADER_NAME) else {
            return Ok(None);
        };

        PropagationDirective::from_header_value(value)
            .map(Some)
            .map_err(|source| {
                AccessTokenSubstrateResourceServiceError::PropagationDirectiveInvalid { source }
            })
    }

    // -----------------------------------------------------------------------
    // Propagation forwarding
    // -----------------------------------------------------------------------

    /// End-to-end propagation: extract, verify, and forward.
    ///
    /// 1. Extracts the bearer token from the `Authorization` header and
    ///    verifies it via the configured [`OAuthResourceServerVerifier`].
    /// 2. Parses the [`PropagationDirective`] from the
    ///    `x-securitydept-propagation` header.
    /// 3. Delegates to [`propagate_bearer`](Self::propagate_bearer).
    ///
    /// This is the recommended entry-point for propagation route handlers.
    pub async fn propagate_request<F: PropagationForwarder>(
        &self,
        forwarder: &F,
        request: http::Request<F::Body>,
    ) -> Result<http::Response<F::Body>, AccessTokenSubstrateResourceServiceError> {
        self.propagate_request_with_diagnosis(forwarder, request)
            .await
            .into_result()
    }

    /// End-to-end propagation with a machine-readable diagnosis surface.
    pub async fn propagate_request_with_diagnosis<F: PropagationForwarder>(
        &self,
        forwarder: &F,
        request: http::Request<F::Body>,
    ) -> DiagnosedResult<http::Response<F::Body>, AccessTokenSubstrateResourceServiceError> {
        let mut diagnosis = AuthFlowDiagnosis::started(AuthFlowOperation::PROPAGATION_FORWARD)
            .field(AuthFlowDiagnosisField::TRANSPORT, "authorization_header")
            .field(
                AuthFlowDiagnosisField::DIRECTIVE_HEADER,
                DEFAULT_PROPAGATION_HEADER_NAME,
            );

        // 1. Extract and verify bearer token.
        let authorization_header = request
            .headers()
            .get(http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok());

        let Some(authorization_str) = authorization_header else {
            return DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field(
                        AuthFlowDiagnosisField::FAILURE_STAGE,
                        "authorization_header",
                    )
                    .field(AuthFlowDiagnosisField::REASON, "missing_bearer_token"),
                AccessTokenSubstrateResourceServiceError::BearerTokenRequired,
            );
        };

        let Some(access_token) = parse_bearer_auth_header_opt(authorization_str) else {
            return DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field(
                        AuthFlowDiagnosisField::FAILURE_STAGE,
                        "authorization_header",
                    )
                    .field(AuthFlowDiagnosisField::REASON, "invalid_bearer_token"),
                AccessTokenSubstrateResourceServiceError::BearerTokenRequired,
            );
        };

        let resource_token_principal = match self
            .verifier
            .verify_token::<CoreJwtClaims>(&access_token)
            .await
        {
            Ok(verified) => verified.to_resource_token_principal(),
            Err(source) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field(AuthFlowDiagnosisField::FAILURE_STAGE, "token_verification"),
                    AccessTokenSubstrateResourceServiceError::OAuthResourceServer { source },
                );
            }
        };

        // 2. Parse propagation directive.
        let Some(directive_header) = request.headers().get(DEFAULT_PROPAGATION_HEADER_NAME) else {
            return DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field(
                        AuthFlowDiagnosisField::FAILURE_STAGE,
                        "propagation_directive",
                    )
                    .field(
                        AuthFlowDiagnosisField::REASON,
                        "missing_propagation_directive",
                    ),
                AccessTokenSubstrateResourceServiceError::PropagationDirectiveRequired,
            );
        };

        let directive = match PropagationDirective::from_header_value(directive_header) {
            Ok(directive) => directive,
            Err(source) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                        .field(
                            AuthFlowDiagnosisField::FAILURE_STAGE,
                            "propagation_directive",
                        )
                        .field(
                            AuthFlowDiagnosisField::REASON,
                            "invalid_propagation_directive",
                        ),
                    AccessTokenSubstrateResourceServiceError::PropagationDirectiveInvalid {
                        source,
                    },
                );
            }
        };

        let bearer = PropagatedBearer {
            access_token: &access_token,
            resource_token_principal: Some(&resource_token_principal),
        };
        let target = directive.to_request_target();
        diagnosis = diagnosis
            .field("target_node_id", target.node_id.clone())
            .field(
                "target_scheme",
                target.scheme.as_ref().map(|scheme| scheme.as_str()),
            )
            .field("target_hostname", target.hostname.clone())
            .field("target_port", target.port);

        // 3. Forward.
        match self
            .propagate_bearer(forwarder, &bearer, &target, request)
            .await
        {
            Ok(response) => DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field(
                        "principal_subject",
                        resource_token_principal.subject.clone(),
                    ),
                response,
            ),
            Err(error) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::FAILURE_STAGE, "forward"),
                error,
            ),
        }
    }

    /// Validate and forward a bearer token to a downstream propagation target.
    ///
    /// This is the low-level building block used by
    /// [`propagate_request`](Self::propagate_request). Use it directly when
    /// the bearer and target have already been extracted and verified by the
    /// caller.
    pub async fn propagate_bearer<F: PropagationForwarder>(
        &self,
        forwarder: &F,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
        request: http::Request<F::Body>,
    ) -> Result<http::Response<F::Body>, AccessTokenSubstrateResourceServiceError> {
        let propagator = self
            .runtime
            .token_propagator()
            .ok_or(AccessTokenSubstrateResourceServiceError::PropagationNotEnabled)?;

        forwarder
            .forward(propagator, bearer, target, request)
            .await
            .map_err(|source| AccessTokenSubstrateResourceServiceError::Propagation { source })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(all(test, feature = "axum-reverse-proxy-propagation-forwarder"))]
mod tests {
    use axum::{
        Json, Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::AUTHORIZATION},
        routing::get,
    };
    use securitydept_oauth_resource_server::ResourceTokenPrincipal;
    use tokio::net::TcpListener;

    use super::*;
    use crate::access_token_substrate::{
        AllowedPropagationTarget, AxumReverseProxyPropagationForwarder,
        AxumReverseProxyPropagationForwarderConfig, DEFAULT_PROPAGATION_HEADER_NAME,
        PropagationDestinationPolicy, PropagationDirective, PropagationScheme, TokenPropagation,
        TokenPropagatorConfig,
    };

    fn make_runtime_and_forwarder(
        upstream_port: u16,
    ) -> (
        AccessTokenSubstrateRuntime,
        AxumReverseProxyPropagationForwarder,
    ) {
        let token_propagation = TokenPropagation::Enabled {
            config: TokenPropagatorConfig {
                destination_policy: PropagationDestinationPolicy {
                    allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                        scheme: PropagationScheme::Http,
                        hostname: "localhost".to_string(),
                        port: upstream_port,
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
        };

        let runtime = AccessTokenSubstrateRuntime::new(&token_propagation)
            .expect("substrate runtime should build");

        let forwarder =
            AxumReverseProxyPropagationForwarder::new(AxumReverseProxyPropagationForwarderConfig {
                proxy_path: "/api/propagation".to_string(),
            })
            .expect("forwarder should build");

        (runtime, forwarder)
    }

    #[tokio::test]
    async fn propagate_bearer_proxies_request_to_upstream() {
        let _ = rustls::crypto::ring::default_provider().install_default();

        // Spin up a minimal upstream that echoes request details and serves
        // a stub JWKS endpoint (needed to construct a valid verifier).
        let upstream = Router::new()
            .route(
                "/api/health",
                get(|request: Request<Body>| async move {
                    let authorization = request
                        .headers()
                        .get(AUTHORIZATION)
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);
                    let propagation_header = request
                        .headers()
                        .get(DEFAULT_PROPAGATION_HEADER_NAME)
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);

                    Json(serde_json::json!({
                        "status": "ok",
                        "path":   request.uri().path(),
                        "query":  request.uri().query(),
                        "authorization": authorization,
                        "propagation_header": propagation_header,
                    }))
                }),
            )
            .route(
                "/jwks",
                get(|| async { Json(serde_json::json!({ "keys": [] })) }),
            );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("upstream listener should bind");
        let upstream_port = listener.local_addr().expect("should have addr").port();
        let upstream_task = tokio::spawn(async move {
            axum::serve(listener, upstream)
                .await
                .expect("upstream server should run");
        });

        let (runtime, forwarder) = make_runtime_and_forwarder(upstream_port);

        // Build a verifier backed by the mock JWKS endpoint.
        // propagate_bearer never calls the verifier — we only need to satisfy
        // the type-level requirement that the service holds a valid reference.
        let verifier_config = securitydept_oauth_resource_server::OAuthResourceServerConfig {
            remote: securitydept_oauth_resource_server::OAuthProviderRemoteConfig {
                issuer_url: Some(format!("http://localhost:{upstream_port}")),
                jwks_uri: Some(format!("http://localhost:{upstream_port}/jwks")),
                ..Default::default()
            },
            ..Default::default()
        };
        let verifier = OAuthResourceServerVerifier::from_config(verifier_config)
            .await
            .expect("verifier should build");
        let service = AccessTokenSubstrateResourceService::new(&runtime, &verifier);

        let directive = PropagationDirective::parse(&format!(
            "by=dashboard;for=local-health;host=localhost:{upstream_port};proto=http"
        ))
        .expect("directive should parse");

        let bearer = PropagatedBearer {
            access_token: "dashboard-at",
            resource_token_principal: Some(&ResourceTokenPrincipal {
                subject: Some("user-1".to_string()),
                issuer: None,
                audiences: Vec::new(),
                scopes: Vec::new(),
                authorized_party: None,
                claims: Default::default(),
            }),
        };
        let target = directive.to_request_target();

        let request = Request::builder()
            .uri("/api/propagation/api/health?via=token-set")
            .header(
                DEFAULT_PROPAGATION_HEADER_NAME,
                directive
                    .to_header_value()
                    .expect("directive should serialize"),
            )
            .body(Body::empty())
            .expect("request should build");

        let response = service
            .propagate_bearer(&forwarder, &bearer, &target, request)
            .await
            .expect("propagation should succeed");

        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should read");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("response body should be json");

        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["path"], "/api/health");
        assert_eq!(payload["query"], "via=token-set");
        assert_eq!(payload["authorization"], "Bearer dashboard-at");
        // The propagation header must be stripped before forwarding.
        assert_eq!(payload["propagation_header"], serde_json::Value::Null);

        upstream_task.abort();
    }
}
