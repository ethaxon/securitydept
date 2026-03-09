use http::StatusCode;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
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
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ToErrorPresentation for CredsManageError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            CredsManageError::Creds { source } => source.to_error_presentation(),
            CredsManageError::EntryNotFound { .. } => ErrorPresentation::new(
                "entry_not_found",
                "The requested auth entry was not found.",
                UserRecovery::None,
            ),
            CredsManageError::GroupNotFound { .. } => ErrorPresentation::new(
                "group_not_found",
                "The requested group was not found.",
                UserRecovery::None,
            ),
            CredsManageError::DuplicateEntryName { .. } => ErrorPresentation::new(
                "duplicate_entry_name",
                "An auth entry with the same name already exists.",
                UserRecovery::None,
            ),
            CredsManageError::DuplicateGroupName { .. } => ErrorPresentation::new(
                "duplicate_group_name",
                "A group with the same name already exists.",
                UserRecovery::None,
            ),
            CredsManageError::ConfigLoad { .. }
            | CredsManageError::DataRead { .. }
            | CredsManageError::DataWrite { .. }
            | CredsManageError::DataParse { .. }
            | CredsManageError::DataSerialize { .. }
            | CredsManageError::InvalidConfig { .. } => ErrorPresentation::new(
                "creds_manage_unavailable",
                "Credential management is temporarily unavailable.",
                UserRecovery::ContactSupport,
            ),
            #[cfg(feature = "migration")]
            CredsManageError::Migration { .. } => ErrorPresentation::new(
                "creds_manage_unavailable",
                "Credential management is temporarily unavailable.",
                UserRecovery::ContactSupport,
            ),
        }
    }
}

pub type CredsManageResult<T> = std::result::Result<T, CredsManageError>;
