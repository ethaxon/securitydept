use clap::Subcommand;
use securitydept_core::creds::hash_password_argon2;
use serde::Serialize;

use crate::{
    error::{CliError, CliResult},
    output::OutputFormat,
    prompt,
};

#[derive(Subcommand)]
pub enum CredsAction {
    /// Generate a Basic Auth user entry for [basic_auth_context.users].
    CreateBasic {
        /// Prompt for all required input, including a masked password
        /// confirmation.
        #[arg(short, long)]
        interactive: bool,
        /// Basic Auth username.
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        username: Option<String>,
        /// Password to hash.
        #[arg(
            long,
            required_unless_present = "interactive",
            conflicts_with = "interactive"
        )]
        password: Option<String>,
        /// Output format.
        #[arg(long, value_enum, default_value_t)]
        format: OutputFormat,
    },
}

#[derive(Serialize)]
struct BasicAuthConfigUser {
    username: String,
    password_hash: String,
}

pub fn execute(action: CredsAction) -> CliResult<()> {
    match action {
        CredsAction::CreateBasic {
            interactive,
            username,
            password,
            format,
        } => {
            let (username, password) = if interactive {
                (
                    prompt::required_text("Basic Auth username")?,
                    prompt::password("Basic Auth password")?,
                )
            } else {
                (
                    username.expect("clap requires username without --interactive"),
                    password.expect("clap requires password without --interactive"),
                )
            };

            if username.is_empty() {
                return Err(CliError::InvalidInput {
                    message: "Basic Auth username must not be empty".to_string(),
                });
            }
            let entry = BasicAuthConfigUser {
                username,
                password_hash: hash_password_argon2(&password)?,
            };
            println!("{}", format_basic_auth_config_user(&entry, format)?);
            Ok(())
        }
    }
}

fn format_basic_auth_config_user(
    entry: &BasicAuthConfigUser,
    format: OutputFormat,
) -> CliResult<String> {
    match format {
        OutputFormat::Toml => Ok(format!(
            "[[basic_auth_context.users]]\nusername = {}\npassword_hash = {}",
            encode_toml_string(&entry.username)?,
            encode_toml_string(&entry.password_hash)?,
        )),
        OutputFormat::Json => {
            serde_json::to_string_pretty(entry).map_err(|error| CliError::Output {
                message: error.to_string(),
            })
        }
    }
}

// JSON string escaping is a TOML basic-string-compatible subset.
fn encode_toml_string(value: &str) -> CliResult<String> {
    serde_json::to_string(value).map_err(|error| CliError::Output {
        message: error.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{BasicAuthConfigUser, format_basic_auth_config_user};
    use crate::output::OutputFormat;

    #[test]
    fn formats_a_toml_basic_auth_user_entry() {
        let output = format_basic_auth_config_user(
            &BasicAuthConfigUser {
                username: "admin".to_string(),
                password_hash: "hash".to_string(),
            },
            OutputFormat::Toml,
        )
        .expect("format entry");

        assert_eq!(
            output,
            "[[basic_auth_context.users]]\nusername = \"admin\"\npassword_hash = \"hash\""
        );
    }
}
