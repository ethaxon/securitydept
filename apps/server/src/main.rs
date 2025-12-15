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
use securitydept_core::config::AppConfig;
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

#[tokio::main]
async fn main() -> Result<(), Whatever> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let cli = Cli::parse();

    info!(config = %cli.config, "Loading configuration");
    let config = AppConfig::load(&cli.config)
        .await
        .whatever_context("Failed to load config")?;

    let store = Store::load(&config.data.path)
        .await
        .whatever_context("Failed to load data store")?;

    let external_base_url = format!("http://{}:{}", config.server.host, config.server.port);

    let oidc = OidcClient::new(&config.oidc, &external_base_url)
        .await
        .whatever_context("Failed to initialize OIDC client")?;

    // Load claims check script if configured
    let claims_script = if let Some(ref path) = config.oidc.claims_check_script {
        let script = claims_engine::load_script(path)
            .await
            .whatever_context("Failed to load claims check script")?;
        Some(Arc::new(script))
    } else {
        None
    };

    // 24-hour session TTL
    let sessions = SessionManager::new(86400);

    let state = AppState {
        config: Arc::new(config.clone()),
        store: Arc::new(store),
        sessions,
        oidc: Arc::new(oidc),
        claims_script,
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
