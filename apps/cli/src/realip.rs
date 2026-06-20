use clap::Subcommand;
use securitydept_core::realip::generate_trusted_bridge_secret_bearer;
use serde::Serialize;

use crate::{
    error::{CliError, CliResult},
    output::OutputFormat,
};

#[derive(Subcommand)]
pub enum RealIpAction {
    /// Generate material for real-IP request headers.
    Header {
        #[command(subcommand)]
        action: RealIpHeaderAction,
    },
}

#[derive(Subcommand)]
pub enum RealIpHeaderAction {
    /// Generate an opaque bearer safe to embed in a trusted-bridge header name.
    CreateSecretBearer {
        /// Output format.
        #[arg(long, value_enum, default_value_t)]
        format: OutputFormat,
    },
}

#[derive(Serialize)]
struct TrustedBridgeSecretBearer {
    secret_bearer: String,
}

pub fn execute(action: RealIpAction) -> CliResult<()> {
    match action {
        RealIpAction::Header {
            action: RealIpHeaderAction::CreateSecretBearer { format },
        } => {
            let output = TrustedBridgeSecretBearer {
                secret_bearer: generate_trusted_bridge_secret_bearer()?,
            };
            println!("{}", format_secret_bearer(&output, format)?);
            Ok(())
        }
    }
}

fn format_secret_bearer(
    output: &TrustedBridgeSecretBearer,
    format: OutputFormat,
) -> CliResult<String> {
    match format {
        OutputFormat::Toml => Ok(format!(
            "secret_bearer = {}",
            serde_json::to_string(&output.secret_bearer).map_err(|error| CliError::Output {
                message: error.to_string(),
            })?,
        )),
        OutputFormat::Json => {
            serde_json::to_string_pretty(output).map_err(|error| CliError::Output {
                message: error.to_string(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{TrustedBridgeSecretBearer, format_secret_bearer};
    use crate::output::OutputFormat;

    #[test]
    fn formats_a_toml_secret_bearer() {
        let output = format_secret_bearer(
            &TrustedBridgeSecretBearer {
                secret_bearer: "secret".to_string(),
            },
            OutputFormat::Toml,
        )
        .expect("format secret");

        assert_eq!(output, "secret_bearer = \"secret\"");
    }
}
