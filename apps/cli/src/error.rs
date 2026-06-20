use securitydept_core::{creds::CredsError, creds_manage::CredsManageError};
use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum CliError {
    #[snafu(display("Failed to load config: {message}"))]
    ConfigLoad { message: String },
    #[snafu(display("Invalid command input: {message}"))]
    InvalidInput { message: String },
    #[snafu(display("Failed to read command input: {message}"))]
    Input { message: String },
    #[snafu(display("Interactive prompt failed: {message}"))]
    Interactive { message: String },
    #[snafu(display("Failed to format command output: {message}"))]
    Output { message: String },
    #[snafu(transparent)]
    CredsManage { source: CredsManageError },
    #[snafu(transparent)]
    Creds { source: CredsError },
    #[snafu(transparent)]
    RealIp {
        source: securitydept_core::realip::RealIpError,
    },
}

pub type CliResult<T> = std::result::Result<T, CliError>;
