use http::StatusCode;
use securitydept_creds::{CredsError, TokenFormat};
use securitydept_oauth_provider::OAuthProviderError;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
use snafu::Snafu;

pub type OAuthResourceServerResult<T> = Result<T, OAuthResourceServerError>;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum OAuthResourceServerError {
    #[snafu(display("OAuth resource server configuration error: {message}"))]
    InvalidConfig { message: String },

    #[snafu(display("OAuth resource server metadata error: {message}"))]
    Metadata { message: String },

    #[snafu(display("OAuth resource server HTTP client error: {message}"))]
    HttpClient { message: String },

    #[snafu(display("OAuth resource server introspection error: {message}"))]
    Introspection { message: String },

    #[snafu(display("OAuth resource server token validation error: {source}"))]
    TokenValidation { source: CredsError },

    #[snafu(display("OAuth resource server policy violation: {message}"))]
    PolicyViolation { message: String },

    #[cfg(feature = "jwe")]
    #[snafu(display("OAuth resource server JWE key error: {message}"))]
    JweKey { message: String },

    #[snafu(display(
        "OAuth resource server does not support {token_format:?} access tokens in this verifier"
    ))]
    UnsupportedTokenFormat { token_format: TokenFormat },
}

impl From<OAuthProviderError> for OAuthResourceServerError {
    fn from(value: OAuthProviderError) -> Self {
        match value {
            OAuthProviderError::InvalidConfig { message } => Self::InvalidConfig { message },
            OAuthProviderError::Metadata { message } => Self::Metadata { message },
            OAuthProviderError::HttpClient { message } => Self::HttpClient { message },
            OAuthProviderError::Introspection { message } => Self::Introspection { message },
        }
    }
}

impl ToHttpStatus for OAuthResourceServerError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            OAuthResourceServerError::TokenValidation { .. }
            | OAuthResourceServerError::PolicyViolation { .. }
            | OAuthResourceServerError::UnsupportedTokenFormat { .. }
            | OAuthResourceServerError::Introspection { .. } => StatusCode::UNAUTHORIZED,
            OAuthResourceServerError::InvalidConfig { .. }
            | OAuthResourceServerError::Metadata { .. }
            | OAuthResourceServerError::HttpClient { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            #[cfg(feature = "jwe")]
            OAuthResourceServerError::JweKey { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ToErrorPresentation for OAuthResourceServerError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            OAuthResourceServerError::TokenValidation { source } => source.to_error_presentation(),
            OAuthResourceServerError::PolicyViolation { .. } => ErrorPresentation::new(
                "access_denied",
                "You do not have permission to access this resource.",
                UserRecovery::None,
            ),
            OAuthResourceServerError::UnsupportedTokenFormat { .. }
            | OAuthResourceServerError::Introspection { .. } => ErrorPresentation::new(
                "auth_invalid_token",
                "The access token is invalid or expired.",
                UserRecovery::Reauthenticate,
            ),
            OAuthResourceServerError::InvalidConfig { .. }
            | OAuthResourceServerError::Metadata { .. }
            | OAuthResourceServerError::HttpClient { .. } => ErrorPresentation::new(
                "auth_temporarily_unavailable",
                "Authentication is temporarily unavailable.",
                UserRecovery::Retry,
            ),
            #[cfg(feature = "jwe")]
            OAuthResourceServerError::JweKey { .. } => ErrorPresentation::new(
                "auth_temporarily_unavailable",
                "Authentication is temporarily unavailable.",
                UserRecovery::Retry,
            ),
        }
    }
}
