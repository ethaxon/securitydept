mod config;
mod error;
mod http_response;
mod middleware;
mod routes;
mod state;

use std::sync::Arc;

use clap::Parser;
use securitydept_core::{
    basic_auth_context::BasicAuthContext,
    creds_manage::{migrations::Migrator, store::CredsManageStore},
    oauth_resource_server::OAuthResourceServerVerifier,
    oidc::OidcClient,
    realip::RealIpResolver,
    token_set_context::{
        access_token_substrate::{AxumReverseProxyPropagationForwarder, TokenPropagator},
        backend_oidc_mediated_mode::BackendOidcMediatedModeRuntime,
    },
};
use snafu::ResultExt;
use tower_sessions_memory_store::MemoryStore;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::{
    config::ServerConfig,
    error::{ServerBootSnafu, ServerResult},
    state::ServerState,
};

#[derive(Parser)]
#[command(name = "securitydept-server", about = "SecurityDept auth server")]
struct Cli {
    /// Path to config file
    #[arg(short, long, default_value = "config.toml")]
    config: String,
}

fn resolve_config_path(cli_config: &str) -> String {
    if cli_config != "config.toml" {
        return cli_config.to_string();
    }

    match std::env::var("SECURITYDEPT_CONFIG") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => cli_config.to_string(),
    }
}

#[tokio::main]
async fn main() -> ServerResult<()> {
    let default_log_level = if cfg!(debug_assertions) {
        "debug"
    } else {
        "info"
    };

    let env_filter = match std::env::var("RUST_LOG") {
        Ok(value) if !value.trim().is_empty() => EnvFilter::from_default_env(),
        _ => EnvFilter::new(default_log_level),
    };

    tracing_subscriber::fmt().with_env_filter(env_filter).init();

    let cli = Cli::parse();

    let config_path = resolve_config_path(&cli.config);
    info!(config = %config_path, "Loading configuration");
    let config = ServerConfig::load(&config_path)?;

    Migrator::default().try_auto_migrate(&config.creds_manage)?;

    let store = CredsManageStore::load(&config.creds_manage.data_path).await?;

    info!(external_base_url = ?config.server.external_base_url, "Resolved external base URL config");

    // Resolve OIDC shared-defaults via
    // BackendOidcMediatedConfigSource::resolve_all().
    let resolved_oidc = config.resolve_oidc()?;

    let oidc = if let Some(ref resolved) = resolved_oidc {
        Some(Arc::new(
            OidcClient::from_config(resolved.oidc_client.clone()).await?,
        ))
    } else {
        info!("OIDC disabled (no [oidc] section); /auth/session/login will create a dev session");
        None
    };

    let token_set_resource_verifier = if let Some(ref resolved) = resolved_oidc {
        Some(Arc::new(
            OAuthResourceServerVerifier::from_config(resolved.oauth_resource_server.clone())
                .await
                .map_err(|e| crate::error::ServerError::InvalidConfig {
                    message: format!("invalid token-set resource verifier config: {e}"),
                })?,
        ))
    } else {
        None
    };

    let session_context_config = config.session_context.clone();
    let session_context_store = MemoryStore::default();
    let real_ip_resolver = if let Some(real_ip_config) = config.real_ip_resolve.clone() {
        Some(Arc::new(
            RealIpResolver::from_config(real_ip_config)
                .await
                .map_err(|e| crate::error::ServerError::InvalidConfig {
                    message: format!("invalid real-ip config: {e}"),
                })?,
        ))
    } else {
        None
    };
    let mediated_runtime = Arc::new(
        BackendOidcMediatedModeRuntime::from_config(config.mediated.mediated_runtime.clone())
            .map_err(|e| crate::error::ServerError::InvalidConfig {
                message: e.to_string(),
            })?,
    );

    let token_propagator = Arc::new(
        TokenPropagator::from_config(&config.mediated.token_propagation).map_err(|e| {
            crate::error::ServerError::InvalidConfig {
                message: format!("token_propagation config: {e}"),
            }
        })?,
    );

    let propagation_forwarder = config
        .propagation_forwarder
        .as_ref()
        .map(|forwarder_config| {
            AxumReverseProxyPropagationForwarder::new(forwarder_config.clone()).map(Arc::new)
        })
        .transpose()
        .map_err(|e| crate::error::ServerError::InvalidConfig {
            message: format!("invalid propagation forwarder config: {e}"),
        })?;

    if propagation_forwarder.is_some() {
        info!("Propagation forwarder enabled");
    }

    let bind_addr = format!("{}:{}", config.server.host, config.server.port);
    info!(addr = %bind_addr, "Starting server");

    let state = ServerState {
        creds_manage_store: Arc::new(store),
        mediated_runtime,
        token_propagator,
        basic_auth_context: Arc::new(
            BasicAuthContext::from_config(config.basic_auth_context.clone()).map_err(|e| {
                crate::error::ServerError::InvalidConfig {
                    message: e.to_string(),
                }
            })?,
        ),
        token_set_resource_verifier,
        real_ip_resolver,
        oidc,
        propagation_forwarder,
        config: Arc::new(config),
    };

    let app =
        routes::build_router(state).layer(securitydept_core::session_context::build_session_layer(
            &session_context_config,
            session_context_store,
        ));

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .boxed()
        .context(ServerBootSnafu)?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .boxed()
    .context(ServerBootSnafu)?;

    Ok(())
}
