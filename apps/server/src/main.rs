mod error;
mod middleware;
mod routes;
mod state;

use std::sync::Arc;

use clap::Parser;
use snafu::{ResultExt, Whatever};
use tracing::info;
use tracing_subscriber::EnvFilter;

use securitydept_core::claims_engine;
use securitydept_core::config::{AppConfig, ExternalBaseUrl};
use securitydept_core::oidc::OidcClient;
use securitydept_core::session::SessionManager;
use securitydept_core::store::Store;

use crate::state::AppState;

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
async fn main() -> Result<(), Whatever> {
    let default_log_level = if cfg!(debug_assertions) {
        "debug"
    } else {
        "info"
    };

    let env_filter = match std::env::var("RUST_LOG") {
        Ok(value) if !value.trim().is_empty() => EnvFilter::from_default_env(),
        _ => EnvFilter::new(default_log_level),
    };

    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .init();

    let cli = Cli::parse();

    let config_path = resolve_config_path(&cli.config);
    info!(config = %config_path, "Loading configuration");
    let config = AppConfig::load(&config_path).whatever_context("Failed to load config")?;

    let store = Store::load(&config.data.path)
        .await
        .whatever_context("Failed to load data store")?;

    let external_base_url = ExternalBaseUrl::from_config(&config.server.external_base_url);
    info!(external_base_url = ?external_base_url, "Resolved external base URL config");

    let (oidc, claims_script) = if let Some(ref oidc_config) = config.oidc {
        let oidc = OidcClient::new(oidc_config)
            .await
            .whatever_context("Failed to initialize OIDC client")?;
        let claims_script = if let Some(ref path) = oidc_config.claims_check_script {
            let script = claims_engine::load_script(path)
                .await
                .whatever_context("Failed to load claims check script")?;
            Some(Arc::new(script))
        } else {
            None
        };
        (Some(Arc::new(oidc)), claims_script)
    } else {
        info!("OIDC disabled (no [oidc] section); /auth/login will create a dev session");
        (None, None)
    };

    // 24-hour session TTL
    let sessions = SessionManager::new(86400);

    let state = AppState {
        config: Arc::new(config.clone()),
        store: Arc::new(store),
        sessions,
        oidc,
        claims_script,
        external_base_url,
        pending_oauth: crate::state::PendingOauthStore::new(),
    };

    let app = routes::build_router(state);

    let bind_addr = format!("{}:{}", config.server.host, config.server.port);
    info!(addr = %bind_addr, "Starting server");

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .whatever_context("Failed to bind server")?;
    axum::serve(listener, app)
        .await
        .whatever_context("Server error")?;

    Ok(())
}
