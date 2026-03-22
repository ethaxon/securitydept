use http::StatusCode;
use securitydept_basic_auth_context::BasicAuthContextError;
use securitydept_creds::CredsError;
use securitydept_oauth_resource_server::OAuthResourceServerError;
use securitydept_oidc_client::OidcError;
use securitydept_session_context::SessionContextError;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
use snafu::Snafu;

#[derive(Debug, Snafu)]
pub enum AuthRuntimeError {
    #[snafu(display("OIDC is disabled"))]
    OidcDisabled,
    #[snafu(transparent)]
    Oidc { source: OidcError },
    #[snafu(transparent)]
    BasicAuthContext { source: BasicAuthContextError },
    #[snafu(transparent)]
    Creds { source: CredsError },
    #[snafu(transparent)]
    OAuthResourceServer { source: OAuthResourceServerError },
    #[snafu(transparent)]
    SessionContext { source: SessionContextError },
    #[snafu(transparent)]
    TokenSetContext {
        source: securitydept_token_set_context::TokenSetContextError,
    },
}

impl AuthRuntimeError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::OidcDisabled => StatusCode::SERVICE_UNAVAILABLE,
            Self::Oidc { source } => source.to_http_status(),
            Self::BasicAuthContext { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Creds { source } => source.to_http_status(),
            Self::OAuthResourceServer { source } => source.to_http_status(),
            Self::SessionContext { source } => source.status_code(),
            Self::TokenSetContext { source } => source.status_code(),
        }
    }
}

impl ToErrorPresentation for AuthRuntimeError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::OidcDisabled => ErrorPresentation::new(
                "oidc_disabled",
                "Authentication is not enabled.",
                UserRecovery::ContactSupport,
            ),
            Self::Oidc { source } => source.to_error_presentation(),
            Self::BasicAuthContext { .. } => ErrorPresentation::new(
                "basic_auth_context_invalid",
                "Basic-auth context is misconfigured.",
                UserRecovery::ContactSupport,
            ),
            Self::Creds { source } => source.to_error_presentation(),
            Self::OAuthResourceServer { source } => source.to_error_presentation(),
            Self::SessionContext { source } => source.to_error_presentation(),
            Self::TokenSetContext { source } => source.to_error_presentation(),
        }
    }
}
