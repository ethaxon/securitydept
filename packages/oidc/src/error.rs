use http::StatusCode;
use securitydept_utils::http::ToHttpStatus;
use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum OidcError {
    #[snafu(display("OIDC metadata error: {message}"))]
    Metadata { message: String },

    #[snafu(display("OIDC token exchange error: {message}"))]
    TokenExchange { message: String },

    #[snafu(display("OIDC redirect URL error: {source}"))]
    RedirectUrl { source: url::ParseError },

    #[snafu(display("OIDC refresh token sealing error: {message}"))]
    RefreshTokenSealing { message: String },

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
}

impl ToHttpStatus for OidcError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            OidcError::ClaimsCheckReject { .. }
            | OidcError::CSRFValidation { .. }
            | OidcError::Claims { .. }
            | OidcError::PendingOauth { .. } => StatusCode::UNAUTHORIZED,
            OidcError::InvalidConfig { .. }
            | OidcError::RefreshTokenSealing { .. }
            | OidcError::Metadata { .. }
            | OidcError::TokenExchange { .. }
            | OidcError::RedirectUrl { .. }
            | OidcError::TokenRefresh { .. }
            | OidcError::ClaimsCheckScriptCompile { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

pub type OidcResult<T> = std::result::Result<T, OidcError>;
