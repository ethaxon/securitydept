use axum::{
    Extension,
    extract::Request,
    response::{IntoResponse, Response},
};
use tracing::debug;

use crate::{error::ServerError, middleware::DashboardAuthContext, state::ServerState};

/// Catch-all handler for propagation-aware forwarding.
///
/// When the dashboard auth context is `Bearer` with a propagation directive,
/// this handler uses the `AxumReverseProxyPropagationForwarder` to forward
/// the request (with a validated bearer token) to the resolved downstream.
pub async fn propagation_forward(
    Extension(state): Extension<ServerState>,
    Extension(auth_context): Extension<DashboardAuthContext>,
    request: Request,
) -> Result<Response, ServerError> {
    let forwarder =
        state
            .propagation_forwarder
            .as_deref()
            .ok_or_else(|| ServerError::InvalidConfig {
                message: "propagation forwarding is not enabled on this server".to_string(),
            })?;

    let bearer = auth_context
        .propagated_bearer()
        .ok_or(ServerError::InvalidConfig {
            message: "propagation forwarding requires bearer authentication".to_string(),
        })?;

    let target = auth_context
        .propagation_target()
        .ok_or(ServerError::InvalidConfig {
            message: "propagation forwarding requires a propagation directive".to_string(),
        })?;

    debug!(
        target = %target_display(&target),
        "Forwarding propagation request"
    );

    let response = forwarder
        .forward(&state.token_propagator, &bearer, &target, request)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Propagation forwarding failed");
            ServerError::InvalidConfig {
                message: format!("propagation forwarding failed: {e}"),
            }
        })?;

    Ok(response.into_response())
}

fn target_display(
    target: &securitydept_core::token_set_context::access_token_substrate::PropagationRequestTarget,
) -> String {
    format!(
        "{}://{}:{}",
        target
            .scheme
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("unknown"),
        target.hostname.as_deref().unwrap_or("unknown"),
        target
            .port
            .map(|p| p.to_string())
            .unwrap_or_else(|| "default".to_string()),
    )
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

    use axum::{
        Extension, Json, Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode, header::AUTHORIZATION},
        routing::get,
    };
    use securitydept_core::{
        basic_auth_context::{BasicAuthContext, BasicAuthContextConfig, BasicAuthZoneConfig},
        creds::Argon2BasicAuthCred,
        creds_manage::{CredsManageConfig, models::DataFile, store::CredsManageStore},
        oauth_resource_server::ResourceTokenPrincipal,
        session_context::SessionContextConfig,
        token_set_context::{
            access_token_substrate::{
                AllowedPropagationTarget, AxumReverseProxyPropagationForwarder,
                AxumReverseProxyPropagationForwarderConfig, PropagationDestinationPolicy,
                PropagationDirective, PropagationScheme, TokenPropagator, TokenPropagatorConfig,
            },
            backend_oidc_mediated_mode::{
                BackendOidcMediatedConfig, BackendOidcMediatedModeRuntime,
                BackendOidcMediatedModeRuntimeConfig, MokaPendingAuthStateMetadataRedemptionConfig,
            },
        },
    };
    use tokio::net::TcpListener;

    use crate::{config::ServerConfig, middleware::DashboardAuthContext, state::ServerState};

    #[tokio::test]
    async fn propagation_forward_proxies_to_same_server_health_path() {
        let _ = rustls::crypto::ring::default_provider().install_default();

        let upstream = Router::new().route(
            "/api/health",
            get(|request: Request<Body>| async move {
                let authorization = request
                    .headers()
                    .get(AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                let propagation_header = request
                    .headers()
                    .get(securitydept_core::token_set_context::access_token_substrate::DEFAULT_PROPAGATION_HEADER_NAME)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);

                Json(serde_json::json!({
                    "status": "ok",
                    "path": request.uri().path(),
                    "query": request.uri().query(),
                    "authorization": authorization,
                    "propagation_header": propagation_header,
                }))
            }),
        );
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("upstream listener should bind");
        let upstream_addr = upstream_listener
            .local_addr()
            .expect("upstream listener should have an address");
        let upstream_server = tokio::spawn(async move {
            axum::serve(upstream_listener, upstream)
                .await
                .expect("upstream server should run");
        });

        let token_propagation_config = TokenPropagatorConfig {
            destination_policy: PropagationDestinationPolicy {
                allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                    scheme: PropagationScheme::Http,
                    hostname: "localhost".to_string(),
                    port: upstream_addr.port(),
                }],
                ..Default::default()
            },
            ..Default::default()
        };
        let mediated_runtime_config =
            BackendOidcMediatedModeRuntimeConfig::<MokaPendingAuthStateMetadataRedemptionConfig> {
                ..Default::default()
            };
        let forwarder_config = AxumReverseProxyPropagationForwarderConfig {
            proxy_path: "/api/propagation".to_string(),
        };
        let data_path = std::env::temp_dir().join(format!(
            "securitydept-propagation-route-test-{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos()
        ));
        std::fs::write(
            &data_path,
            serde_json::to_vec(&DataFile::default()).expect("default data file should serialize"),
        )
        .expect("test data file should be written");

        let state = ServerState {
            config: Arc::new(ServerConfig {
                server: Default::default(),
                oidc: None,
                mediated: BackendOidcMediatedConfig {
                    oidc_client: Default::default(),
                    oauth_resource_server: Default::default(),
                    mediated_runtime: mediated_runtime_config.clone(),
                    token_propagation: token_propagation_config.clone(),
                },
                session_context: SessionContextConfig::default(),
                basic_auth_context: BasicAuthContextConfig::<Argon2BasicAuthCred>::builder()
                    .zones(vec![BasicAuthZoneConfig::default()])
                    .build(),
                real_ip_resolve: None,
                creds_manage: CredsManageConfig {
                    data_path: data_path.to_string_lossy().into_owned(),
                    ..Default::default()
                },
                propagation_forwarder: Some(forwarder_config.clone()),
            }),
            creds_manage_store: Arc::new(
                CredsManageStore::load(&data_path)
                    .await
                    .expect("creds store should load"),
            ),
            mediated_runtime: Arc::new(
                BackendOidcMediatedModeRuntime::from_config(mediated_runtime_config)
                    .expect("mediated runtime should build"),
            ),
            token_propagator: Arc::new(
                TokenPropagator::from_config(&token_propagation_config)
                    .expect("token propagator should build"),
            ),
            basic_auth_context: Arc::new(
                BasicAuthContext::from_config(
                    BasicAuthContextConfig::<Argon2BasicAuthCred>::builder()
                        .zones(vec![BasicAuthZoneConfig::default()])
                        .build(),
                )
                .expect("basic auth context should build"),
            ),
            token_set_resource_verifier: None,
            real_ip_resolver: None,
            oidc: None,
            propagation_forwarder: Some(Arc::new(
                AxumReverseProxyPropagationForwarder::new(forwarder_config)
                    .expect("propagation forwarder should build"),
            )),
        };

        let propagation_directive = PropagationDirective::parse(&format!(
            "by=dashboard;for=local-health;host=localhost:{};proto=http",
            upstream_addr.port()
        ))
        .expect("directive should parse");
        let response = super::propagation_forward(
            Extension(state),
            Extension(DashboardAuthContext::Bearer {
                access_token: "dashboard-at".to_string(),
                resource_token_principal: Box::new(ResourceTokenPrincipal {
                    subject: Some("user-1".to_string()),
                    issuer: None,
                    audiences: Vec::new(),
                    scopes: Vec::new(),
                    authorized_party: None,
                    claims: HashMap::new(),
                }),
                propagation: Some(propagation_directive.clone()),
            }),
            Request::builder()
                .uri("/api/propagation/api/health?via=token-set")
                .header(
                    securitydept_core::token_set_context::access_token_substrate::DEFAULT_PROPAGATION_HEADER_NAME,
                    propagation_directive
                        .to_header_value()
                        .expect("directive should serialize"),
                )
                .body(Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("propagation forward should succeed");

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
        assert_eq!(payload["propagation_header"], serde_json::Value::Null);

        upstream_server.abort();
        let _ = std::fs::remove_file(&data_path);
    }
}
