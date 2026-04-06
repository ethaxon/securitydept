use http::StatusCode;
use securitydept_oauth_provider::OAuthProviderError;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum OidcError {
    #[snafu(display("OIDC metadata error: {message}"))]
    Metadata { message: String },

    #[snafu(display("OIDC token exchange error: {message}"))]
    TokenExchange { message: String },

    #[snafu(display("OIDC device authorization error: {message}"))]
    DeviceAuthorization { message: String },

    #[snafu(display("OIDC device token poll error: {message}"))]
    DeviceTokenPoll { message: String },

    #[snafu(display("OIDC redirect URL error: {source}"))]
    RedirectUrl { source: url::ParseError },

    #[snafu(display("OIDC claims error: {message}"))]
    Claims { message: String },

    #[snafu(display("OIDC claims check script compile error: {message}"))]
    ClaimsCheckScriptCompile { message: String },

    #[snafu(display("OIDC claims check reject error: {message}"))]
    ClaimsCheckReject { message: String },

    #[snafu(display("OIDC invalid configuration: {message}"))]
    InvalidConfig { message: String },

    #[snafu(display("OIDC CSRF validation error: {message}"))]
    CSRFValidation { message: String },

    #[snafu(display("OIDC pending OAuth error: {source}"))]
    PendingOauth {
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[snafu(display("OIDC token refresh error: {message}"))]
    TokenRefresh { message: String },

    #[snafu(display("OIDC token revocation error: {message}"))]
    TokenRevocation { message: String },

    /// Token endpoint returned a scope set that does not satisfy
    /// `required_scopes`. `missing` lists the absent scopes.
    #[snafu(display("OIDC scope validation error: token is missing required scopes: {missing:?}"))]
    ScopeValidation { missing: Vec<String> },
}

impl ToHttpStatus for OidcError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            OidcError::ClaimsCheckReject { .. }
            | OidcError::CSRFValidation { .. }
            | OidcError::Claims { .. }
            | OidcError::PendingOauth { .. } => StatusCode::UNAUTHORIZED,
            OidcError::InvalidConfig { .. }
            | OidcError::Metadata { .. }
            | OidcError::TokenExchange { .. }
            | OidcError::DeviceAuthorization { .. }
            | OidcError::DeviceTokenPoll { .. }
            | OidcError::RedirectUrl { .. }
            | OidcError::TokenRefresh { .. }
            | OidcError::TokenRevocation { .. }
            | OidcError::ClaimsCheckScriptCompile { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            OidcError::ScopeValidation { .. } => StatusCode::FORBIDDEN,
        }
    }
}

pub type OidcResult<T> = std::result::Result<T, OidcError>;

impl From<OAuthProviderError> for OidcError {
    fn from(value: OAuthProviderError) -> Self {
        match value {
            OAuthProviderError::InvalidConfig { message } => Self::InvalidConfig { message },
            OAuthProviderError::Metadata { message } => Self::Metadata { message },
            OAuthProviderError::HttpClient { message } => Self::Metadata { message },
            OAuthProviderError::Introspection { message } => Self::TokenExchange { message },
        }
    }
}

impl ToErrorPresentation for OidcError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            OidcError::RedirectUrl { .. } => ErrorPresentation::new(
                "oidc_redirect_url_invalid",
                "The login redirect URL is invalid.",
                UserRecovery::ContactSupport,
            ),
            OidcError::CSRFValidation { .. } => ErrorPresentation::new(
                "oidc_request_invalid",
                "The sign-in request is no longer valid. Start again.",
                UserRecovery::RestartFlow,
            ),
            OidcError::PendingOauth { .. } => ErrorPresentation::new(
                "oidc_request_expired",
                "The sign-in request expired or was already used. Start again.",
                UserRecovery::RestartFlow,
            ),
            OidcError::ClaimsCheckReject { .. } => ErrorPresentation::new(
                "oidc_access_denied",
                "Your account is not allowed to sign in.",
                UserRecovery::ContactSupport,
            ),
            OidcError::DeviceAuthorization { .. } => ErrorPresentation::new(
                "oidc_device_authorization_failed",
                "The device sign-in could not be started. Try again.",
                UserRecovery::Retry,
            ),
            OidcError::DeviceTokenPoll { .. } => ErrorPresentation::new(
                "oidc_device_sign_in_failed",
                "The device sign-in could not be completed. Start again.",
                UserRecovery::RestartFlow,
            ),
            OidcError::TokenRefresh { .. } => ErrorPresentation::new(
                "oidc_reauthentication_required",
                "Your sign-in session expired. Sign in again.",
                UserRecovery::Reauthenticate,
            ),
            OidcError::TokenRevocation { .. } => ErrorPresentation::new(
                "oidc_token_revocation_failed",
                "The token could not be revoked. Try again.",
                UserRecovery::Retry,
            ),
            OidcError::Metadata { .. } | OidcError::TokenExchange { .. } => ErrorPresentation::new(
                "oidc_sign_in_failed",
                "The sign-in could not be completed. Start again.",
                UserRecovery::RestartFlow,
            ),
            OidcError::Claims { .. } => ErrorPresentation::new(
                "oidc_invalid_response",
                "The sign-in response was invalid. Start again.",
                UserRecovery::RestartFlow,
            ),
            OidcError::ClaimsCheckScriptCompile { .. } | OidcError::InvalidConfig { .. } => {
                ErrorPresentation::new(
                    "oidc_temporarily_unavailable",
                    "Authentication is temporarily unavailable.",
                    UserRecovery::ContactSupport,
                )
            }
            OidcError::ScopeValidation { .. } => ErrorPresentation::new(
                "oidc_insufficient_scope",
                "The issued token does not grant the required permissions.",
                UserRecovery::ContactSupport,
            ),
        }
    }
}
