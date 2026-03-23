use http::StatusCode;
#[cfg(feature = "basic-auth-context")]
use securitydept_basic_auth_context::BasicAuthContextError;
#[cfg(any(feature = "basic-auth-context", feature = "token-set-context"))]
use securitydept_creds::CredsError;
#[cfg(feature = "token-set-context")]
use securitydept_oauth_resource_server::OAuthResourceServerError;
#[cfg(any(feature = "session-context", feature = "token-set-context"))]
use securitydept_oidc_client::OidcError;
#[cfg(feature = "session-context")]
use securitydept_session_context::SessionContextError;
use securitydept_utils::error::{ErrorPresentation, ToErrorPresentation};
#[cfg(any(
    feature = "basic-auth-context",
    feature = "session-context",
    feature = "token-set-context"
))]
use securitydept_utils::{error::UserRecovery, http::ToHttpStatus};
use snafu::Snafu;

#[derive(Debug, Snafu)]
pub enum AuthRuntimeError {
    #[cfg(any(feature = "session-context", feature = "token-set-context"))]
    #[snafu(display("OIDC is disabled"))]
    OidcDisabled,
    #[cfg(any(feature = "session-context", feature = "token-set-context"))]
    #[snafu(transparent)]
    Oidc { source: OidcError },
    #[cfg(feature = "basic-auth-context")]
    #[snafu(transparent)]
    BasicAuthContext { source: BasicAuthContextError },
    #[cfg(any(feature = "basic-auth-context", feature = "token-set-context"))]
    #[snafu(transparent)]
    Creds { source: CredsError },
    #[cfg(feature = "token-set-context")]
    #[snafu(transparent)]
    OAuthResourceServer { source: OAuthResourceServerError },
    #[cfg(feature = "session-context")]
    #[snafu(transparent)]
    SessionContext { source: SessionContextError },
    #[cfg(feature = "token-set-context")]
    #[snafu(transparent)]
    TokenSetContext {
        source: securitydept_token_set_context::TokenSetContextError,
    },
}

impl AuthRuntimeError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            #[cfg(any(feature = "session-context", feature = "token-set-context"))]
            Self::OidcDisabled => StatusCode::SERVICE_UNAVAILABLE,
            #[cfg(any(feature = "session-context", feature = "token-set-context"))]
            Self::Oidc { source } => source.to_http_status(),
            #[cfg(feature = "basic-auth-context")]
            Self::BasicAuthContext { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            #[cfg(any(feature = "basic-auth-context", feature = "token-set-context"))]
            Self::Creds { source } => source.to_http_status(),
            #[cfg(feature = "token-set-context")]
            Self::OAuthResourceServer { source } => source.to_http_status(),
            #[cfg(feature = "session-context")]
            Self::SessionContext { source } => source.status_code(),
            #[cfg(feature = "token-set-context")]
            Self::TokenSetContext { source } => source.status_code(),
            #[cfg(not(any(
                feature = "basic-auth-context",
                feature = "session-context",
                feature = "token-set-context",
            )))]
            _ => unreachable!("AuthRuntimeError is uninhabited when no runtime feature is enabled"),
        }
    }
}

impl ToErrorPresentation for AuthRuntimeError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            #[cfg(any(feature = "session-context", feature = "token-set-context"))]
            Self::OidcDisabled => ErrorPresentation::new(
                "oidc_disabled",
                "Authentication is not enabled.",
                UserRecovery::ContactSupport,
            ),
            #[cfg(any(feature = "session-context", feature = "token-set-context"))]
            Self::Oidc { source } => source.to_error_presentation(),
            #[cfg(feature = "basic-auth-context")]
            Self::BasicAuthContext { .. } => ErrorPresentation::new(
                "basic_auth_context_invalid",
                "Basic-auth context is misconfigured.",
                UserRecovery::ContactSupport,
            ),
            #[cfg(any(feature = "basic-auth-context", feature = "token-set-context"))]
            Self::Creds { source } => source.to_error_presentation(),
            #[cfg(feature = "token-set-context")]
            Self::OAuthResourceServer { source } => source.to_error_presentation(),
            #[cfg(feature = "session-context")]
            Self::SessionContext { source } => source.to_error_presentation(),
            #[cfg(feature = "token-set-context")]
            Self::TokenSetContext { source } => source.to_error_presentation(),
            #[cfg(not(any(
                feature = "basic-auth-context",
                feature = "session-context",
                feature = "token-set-context",
            )))]
            _ => unreachable!("AuthRuntimeError is uninhabited when no runtime feature is enabled"),
        }
    }
}
