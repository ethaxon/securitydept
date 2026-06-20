mod config;
mod creds;
mod creds_manage;
mod error;
mod output;
mod prompt;
mod realip;

use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use crate::{config::CliConfig, error::CliResult};

#[derive(Parser)]
#[command(name = "securitydept-cli", about = "SecurityDept management CLI")]
struct Cli {
    /// Path to config.toml, required only by `creds-manage` commands.
    #[arg(short, long, default_value = "config.toml")]
    config: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate static credential material without modifying files.
    Creds {
        #[command(subcommand)]
        action: creds::CredsAction,
    },
    /// Manage entries and groups stored in [creds_manage].data_path.
    CredsManage {
        #[command(subcommand)]
        action: creds_manage::CredsManageAction,
    },
    /// Generate material for real-IP resolver configuration.
    #[command(name = "realip")]
    RealIp {
        #[command(subcommand)]
        action: realip::RealIpAction,
    },
}

#[tokio::main]
async fn main() -> CliResult<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("warn".parse().unwrap()))
        .init();

    let cli = Cli::parse();
    match cli.command {
        Commands::Creds { action } => creds::execute(action),
        Commands::RealIp { action } => realip::execute(action),
        Commands::CredsManage { action } => {
            let config = CliConfig::load(cli.config)?;
            creds_manage::execute(&config, action).await
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::{CommandFactory, Parser};

    use super::{Cli, Commands};

    #[test]
    fn parses_static_commands_without_a_config_path() {
        let cli = Cli::try_parse_from([
            "securitydept-cli",
            "creds",
            "create-basic",
            "--username",
            "admin",
            "--password",
            "password",
        ])
        .expect("parse static credential command");

        assert!(matches!(cli.command, Commands::Creds { .. }));
    }

    #[test]
    fn parses_interactive_credential_commands_without_explicit_values() {
        let cli = Cli::try_parse_from(["securitydept-cli", "creds", "create-basic", "-i"])
            .expect("parse interactive static credential command");
        assert!(matches!(cli.command, Commands::Creds { .. }));

        let cli = Cli::try_parse_from([
            "securitydept-cli",
            "creds-manage",
            "entry",
            "create-basic",
            "-i",
        ])
        .expect("parse interactive managed credential command");
        assert!(matches!(cli.command, Commands::CredsManage { .. }));
    }

    #[test]
    fn parses_the_realip_header_command() {
        let cli = Cli::try_parse_from([
            "securitydept-cli",
            "realip",
            "header",
            "create-secret-bearer",
        ])
        .expect("parse real-ip command");

        assert!(matches!(cli.command, Commands::RealIp { .. }));
    }

    #[test]
    fn command_constraints_are_valid() {
        Cli::command().debug_assert();
    }
}
