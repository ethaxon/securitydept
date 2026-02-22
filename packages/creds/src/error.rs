//! Error types for Basic Authentication.
use http::StatusCode;
use securitydept_utils::http::ToHttpStatus;
use snafu::Snafu;

/// Result type alias for Basic Authentication operations.
pub type CredsResult<T> = Result<T, CredsError>;

/// Errors that can occur during Basic Authentication.
#[derive(Debug, Snafu)]
pub enum CredsError {
    #[snafu(display("Invalid credentials format: {message}"))]
    InvalidCredentialsFormat { message: String },
    #[snafu(display("Invalid credentials: username or password is incorrect"))]
    InvalidCredentials,

    #[snafu(display("Configuration error: {message}"))]
    ConfigError { message: String },

    #[snafu(display("Password hash error: {message}"))]
    PasswordHash { message: String },

    #[snafu(display("Random bytes error: {message}"))]
    RandomBytes { message: String },
}

impl ToHttpStatus for CredsError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            CredsError::InvalidCredentialsFormat { .. } | CredsError::InvalidCredentials => {
                StatusCode::UNAUTHORIZED
            }
            CredsError::PasswordHash { .. }
            | CredsError::ConfigError { .. }
            | CredsError::RandomBytes { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}
