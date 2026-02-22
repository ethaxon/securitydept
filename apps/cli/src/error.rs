use securitydept_creds::CredsError;
use securitydept_creds_manage::CredsManageError;
use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum CliError {
    #[snafu(display("Failed to load config: {message}"))]
    ConfigLoad { message: String },
    #[snafu(transparent)]
    CredsManage { source: CredsManageError },
    #[snafu(transparent)]
    Creds { source: CredsError },
}

pub type CliResult<T> = std::result::Result<T, CliError>;
