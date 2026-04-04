use http::StatusCode;
use securitydept_oidc_client::OidcError;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
use snafu::Snafu;

use super::{
    PendingAuthStateMetadataRedemptionStoreError, RefreshMaterialError, TokenSetRedirectUriError,
};

#[derive(Debug, Snafu)]
pub enum BackendOidcMediatedModeRuntimeError {
    #[snafu(display("backend-oidc-mediated mode runtime is misconfigured: {message}"))]
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
}

pub type BackendOidcMediatedModeRuntimeResult<T> = Result<T, BackendOidcMediatedModeRuntimeError>;

impl BackendOidcMediatedModeRuntimeError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::Oidc { source } => source.to_http_status(),
            Self::ContextConfig { .. }
            | Self::RefreshMaterial { .. }
            | Self::RedirectUri { .. }
            | Self::MetadataRedemption { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ToErrorPresentation for BackendOidcMediatedModeRuntimeError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::Oidc { source } => source.to_error_presentation(),
            Self::ContextConfig { .. } => ErrorPresentation::new(
                "mediated_context_invalid",
                "Backend-oidc-mediated mode runtime is misconfigured.",
                UserRecovery::ContactSupport,
            ),
            Self::RefreshMaterial { .. } => ErrorPresentation::new(
                "mediated_refresh_material_invalid",
                "The sign-in state is no longer valid. Sign in again.",
                UserRecovery::Reauthenticate,
            ),
            Self::RedirectUri { .. } => ErrorPresentation::new(
                "mediated_post_auth_redirect_uri_invalid",
                "The mediated redirect URL is invalid.",
                UserRecovery::RestartFlow,
            ),
            Self::MetadataRedemption { .. } => ErrorPresentation::new(
                "mediated_metadata_unavailable",
                "Authentication metadata is temporarily unavailable.",
                UserRecovery::Retry,
            ),
        }
    }
}
