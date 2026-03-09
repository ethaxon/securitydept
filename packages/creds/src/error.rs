//! Error types for Basic Authentication.
use http::StatusCode;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
use snafu::Snafu;

/// Result type alias for Basic Authentication operations.
pub type CredsResult<T> = Result<T, CredsError>;

/// Errors that can occur during Basic Authentication.
#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum CredsError {
    #[snafu(display("Invalid credentials format: {message}"))]
    InvalidCredentialsFormat { message: String },
    #[snafu(display("Invalid basic credentials: username or password is incorrect"))]
    InvalidBasicCredentials,

    #[snafu(display("Invalid static token credentials: token is incorrect"))]
    InvalidStaticTokenCredentials,

    #[snafu(display("Configuration error: {message}"))]
    ConfigError { message: String },

    #[snafu(display("Password hash error: {message}"))]
    PasswordHash { message: String },

    #[snafu(display("Random bytes error: {message}"))]
    RandomBytes { message: String },

    #[cfg(feature = "jwt")]
    #[snafu(display("JSON Web Token error: {source}"))]
    JSONWebToken { source: jsonwebtoken::errors::Error },

    #[cfg(feature = "jwe")]
    #[snafu(display("JWE error: {source}"))]
    JoseKit { source: josekit::JoseError },
}

impl ToHttpStatus for CredsError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            CredsError::InvalidCredentialsFormat { .. }
            | CredsError::InvalidBasicCredentials
            | CredsError::InvalidStaticTokenCredentials => StatusCode::UNAUTHORIZED,
            #[cfg(feature = "jwt")]
            CredsError::JSONWebToken { .. } => StatusCode::UNAUTHORIZED,
            #[cfg(feature = "jwe")]
            CredsError::JoseKit { .. } => StatusCode::UNAUTHORIZED,
            CredsError::PasswordHash { .. }
            | CredsError::ConfigError { .. }
            | CredsError::RandomBytes { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ToErrorPresentation for CredsError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            CredsError::InvalidCredentialsFormat { .. } => ErrorPresentation::new(
                "auth_invalid_credentials_format",
                "The provided credentials are invalid.",
                UserRecovery::Reauthenticate,
            ),
            CredsError::InvalidBasicCredentials => ErrorPresentation::new(
                "auth_invalid_basic_credentials",
                "Username or password is incorrect.",
                UserRecovery::Reauthenticate,
            ),
            CredsError::InvalidStaticTokenCredentials => ErrorPresentation::new(
                "auth_invalid_static_token",
                "The access token is invalid.",
                UserRecovery::Reauthenticate,
            ),
            #[cfg(feature = "jwt")]
            CredsError::JSONWebToken { .. } => ErrorPresentation::new(
                "auth_invalid_token",
                "The access token is invalid or expired.",
                UserRecovery::Reauthenticate,
            ),
            #[cfg(feature = "jwe")]
            CredsError::JoseKit { .. } => ErrorPresentation::new(
                "auth_invalid_token",
                "The access token is invalid or expired.",
                UserRecovery::Reauthenticate,
            ),
            CredsError::PasswordHash { .. }
            | CredsError::ConfigError { .. }
            | CredsError::RandomBytes { .. } => ErrorPresentation::new(
                "auth_temporarily_unavailable",
                "Authentication is temporarily unavailable.",
                UserRecovery::ContactSupport,
            ),
        }
    }
}
