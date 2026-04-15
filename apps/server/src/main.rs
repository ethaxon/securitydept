mod config;
mod error;
mod http_response;
mod middleware;
mod routes;
mod state;

use std::sync::Arc;

use clap::{Parser, Subcommand};
use securitydept_core::{
    basic_auth_context::BasicAuthContext,
    creds::hash_password_argon2,
    creds_manage::{migrations::Migrator, store::CredsManageStore},
    realip::RealIpResolver,
    token_set_context::{
        access_token_substrate::{
            AccessTokenSubstrateRuntime, AxumReverseProxyPropagationForwarderConfig,
        },
        backend_oidc_mode::BackendOidcModeRuntime,
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
    #[command(subcommand)]
    command: Option<Command>,

    /// Path to config file (used by `serve`)
    #[arg(short, long, default_value = "config.toml", global = true)]
    config: String,
}

#[derive(Subcommand)]
enum Command {
    /// Start the server (default when no subcommand is given)
    Serve,
    /// Generate an Argon2id password hash for use in config.toml
    HashPassword {
        /// Password to hash (reads from stdin if omitted)
        #[arg(short, long)]
        password: Option<String>,
    },
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
    let cli = Cli::parse();

    match cli.command.unwrap_or(Command::Serve) {
        Command::HashPassword { password } => {
            run_hash_password(password);
            Ok(())
        }
        Command::Serve => run_serve(cli.config).await,
    }
}

/// Generate an Argon2id hash and print it to stdout.
fn run_hash_password(password: Option<String>) {
    let password = password.unwrap_or_else(|| {
        eprint!("Enter password: ");
        let mut input = String::new();
        std::io::stdin()
            .read_line(&mut input)
            .expect("failed to read password from stdin");
        input.trim().to_string()
    });

    if password.is_empty() {
        eprintln!("Error: password must not be empty");
        std::process::exit(1);
    }

    match hash_password_argon2(&password) {
        Ok(hash) => println!("{hash}"),
        Err(e) => {
            eprintln!("Error: failed to hash password: {e}");
            std::process::exit(1);
        }
    }
}

async fn run_serve(config_arg: String) -> ServerResult<()> {
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

    let config_path = resolve_config_path(&config_arg);
    info!(config = %config_path, "Loading configuration");
    let config = ServerConfig::load(&config_path)?;

    Migrator::default().try_auto_migrate(&config.creds_manage)?;

    let store = CredsManageStore::load(&config.creds_manage.data_path).await?;

    info!(external_base_url = ?config.server.external_base_url, "Resolved external base URL config");

    // Build OIDC runtime artifacts: backend-oidc runtime + optional OIDC client.
    let resolved_oidc = config.resolve_oidc()?;
    let (backend_oidc_runtime, oidc_client) = BackendOidcModeRuntime::from_resolved_config::<
        state::MokaPendingOauthStore,
    >(resolved_oidc.as_ref())
    .await
    .map_err(|e| crate::error::ServerError::InvalidConfig {
        message: format!("backend_oidc: {e}"),
    })?;
    if oidc_client.is_none() {
        info!("OIDC disabled (no [oidc] section); /auth/session/login will create a dev session");
    }

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

    // Build access-token substrate runtime + optional resource-server verifier.
    let resolved_substrate = config.resolve_substrate()?;
    let (substrate_runtime, oauth_resource_server_verifier) =
        AccessTokenSubstrateRuntime::from_resolved_config(&resolved_substrate)
            .await
            .map_err(|e| crate::error::ServerError::InvalidConfig {
                message: format!("access_token_substrate: {e}"),
            })?;

    let propagation_forwarder = if substrate_runtime.propagation_enabled() {
        let forwarder_config = AxumReverseProxyPropagationForwarderConfig::builder()
            .proxy_path("/api/propagation".to_string())
            .build();
        substrate_runtime
            .build_forwarder(&forwarder_config)
            .transpose()
            .map_err(|e| crate::error::ServerError::InvalidConfig {
                message: format!("invalid propagation forwarder config: {e}"),
            })?
            .map(Arc::new)
    } else {
        None
    };

    if propagation_forwarder.is_some() {
        info!("Propagation forwarder enabled");
    }

    let bind_addr = format!("{}:{}", config.server.host, config.server.port);
    info!(addr = %bind_addr, "Starting server");

    let state = ServerState {
        creds_manage_store: Arc::new(store),
        backend_oidc_runtime: Arc::new(backend_oidc_runtime),
        substrate_runtime,
        basic_auth_context: Arc::new(
            BasicAuthContext::from_config(config.basic_auth_context.clone()).map_err(|e| {
                crate::error::ServerError::InvalidConfig {
                    message: e.to_string(),
                }
            })?,
        ),
        real_ip_resolver,
        oidc_client,
        oauth_resource_server_verifier,
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
