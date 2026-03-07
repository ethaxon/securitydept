//! Error types for Basic Authentication.
use http::StatusCode;
use securitydept_utils::http::ToHttpStatus;
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
