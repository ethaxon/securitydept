use http::StatusCode;
use securitydept_utils::http::ToHttpStatus;
use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum CredsManageError {
    #[snafu(display("Failed to load config: {message}"))]
    ConfigLoad { message: String },

    #[snafu(display("Failed to read data file: {source}"))]
    DataRead { source: std::io::Error },

    #[snafu(display("Failed to write data file: {source}"))]
    DataWrite { source: std::io::Error },

    #[snafu(display("Failed to parse data: {source}"))]
    DataParse { source: serde_json::Error },

    #[snafu(display("Failed to serialize data: {source}"))]
    DataSerialize { source: serde_json::Error },

    #[snafu(display("Entry not found: {id}"))]
    EntryNotFound { id: String },

    #[snafu(display("Group not found: {id}"))]
    GroupNotFound { id: String },

    #[snafu(display("Duplicate entry name: {name}"))]
    DuplicateEntryName { name: String },

    #[snafu(display("Duplicate group name: {name}"))]
    DuplicateGroupName { name: String },

    #[snafu(display("Session not found"))]
    SessionNotFound,

    #[snafu(display("Invalid configuration: {message}"))]
    InvalidConfig { message: String },

    #[snafu(transparent)]
    Creds {
        source: securitydept_creds::error::CredsError,
    },
    #[cfg(feature = "migration")]
    #[snafu(display("Migration error: {source}"), context(false))]
    Migration {
        source: Box<dyn std::error::Error + Send + Sync>,
    },
}

impl ToHttpStatus for CredsManageError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            creds_error @ CredsManageError::Creds { .. } => creds_error.to_http_status(),
            CredsManageError::EntryNotFound { .. } | CredsManageError::GroupNotFound { .. } => {
                StatusCode::NOT_FOUND
            }
            CredsManageError::DuplicateEntryName { .. }
            | CredsManageError::DuplicateGroupName { .. } => StatusCode::CONFLICT,
            CredsManageError::SessionNotFound => StatusCode::UNAUTHORIZED,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

pub type CredsManageResult<T> = std::result::Result<T, CredsManageError>;
