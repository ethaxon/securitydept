mod config;
mod error;
mod middleware;
mod routes;
mod state;

use std::sync::Arc;

use clap::Parser;
use securitydept_core::{
    creds_manage::{migrations::Migrator, store::CredsManageStore},
    oidc::OidcClient,
    token_set_context::TokenSetContext,
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

    let oidc = if let Some(ref oidc_config) = config.oidc {
        Some(Arc::new(
            OidcClient::from_config(oidc_config.clone()).await?,
        ))
    } else {
        info!("OIDC disabled (no [oidc] section); /auth/session/login will create a dev session");
        None
    };

    let session_context_config = config.session_context.clone();
    let session_context_store = MemoryStore::default();
    let token_set_context = Arc::new(
        TokenSetContext::from_config(config.token_set_context.clone()).map_err(|e| {
            crate::error::ServerError::InvalidConfig {
                message: e.to_string(),
            }
        })?,
    );

    let bind_addr = format!("{}:{}", config.server.host, config.server.port);
    info!(addr = %bind_addr, "Starting server");

    let state = ServerState {
        creds_manage_store: Arc::new(store),
        token_set_context,
        oidc,
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
    axum::serve(listener, app)
        .await
        .boxed()
        .context(ServerBootSnafu)?;

    Ok(())
}
