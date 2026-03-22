use http::StatusCode;
use securitydept_oidc_client::OidcError;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
use snafu::Snafu;

use crate::{
    PendingAuthStateMetadataRedemptionStoreError, RefreshMaterialError, TokenPropagatorError,
    TokenSetRedirectUriError,
};

#[derive(Debug, Snafu)]
pub enum TokenSetContextError {
    #[snafu(display("token-set context is misconfigured: {message}"))]
    ContextConfig { message: String },
    #[snafu(display("refresh material operation failed: {source}"))]
    RefreshMaterial { source: RefreshMaterialError },
    #[snafu(display("redirect uri operation failed: {source}"))]
    RedirectUri { source: TokenSetRedirectUriError },
    #[snafu(display("OIDC operation failed: {source}"), context(false))]
    Oidc { source: OidcError },
    #[snafu(
        display("metadata redemption operation failed: {source}"),
        context(false)
    )]
    MetadataRedemption {
        source: PendingAuthStateMetadataRedemptionStoreError,
    },
    #[snafu(display("token propagator operation failed: {source}"), context(false))]
    TokenPropagatorError { source: TokenPropagatorError },
}

pub type TokenSetContextResult<T> = Result<T, TokenSetContextError>;

impl TokenSetContextError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::Oidc { source } => source.to_http_status(),
            Self::ContextConfig { .. }
            | Self::RefreshMaterial { .. }
            | Self::RedirectUri { .. }
            | Self::MetadataRedemption { .. }
            | Self::TokenPropagatorError { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ToErrorPresentation for TokenSetContextError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::Oidc { source } => source.to_error_presentation(),
            Self::ContextConfig { .. } => ErrorPresentation::new(
                "token_set_context_invalid",
                "Token-set authentication is misconfigured.",
                UserRecovery::ContactSupport,
            ),
            Self::RefreshMaterial { .. } => ErrorPresentation::new(
                "token_set_refresh_material_invalid",
                "The sign-in state is no longer valid. Sign in again.",
                UserRecovery::Reauthenticate,
            ),
            Self::RedirectUri { .. } => ErrorPresentation::new(
                "token_set_post_auth_redirect_uri_invalid",
                "The token-set redirect URL is invalid.",
                UserRecovery::RestartFlow,
            ),
            Self::MetadataRedemption { .. } => ErrorPresentation::new(
                "token_set_metadata_unavailable",
                "Authentication metadata is temporarily unavailable.",
                UserRecovery::Retry,
            ),
            e @ Self::TokenPropagatorError { .. } => e.to_error_presentation(),
        }
    }
}
