//! Shared orchestration abstractions — cross-mode lifecycle infrastructure.
//!
//! This module provides types and utilities shared across all OIDC modes:
//!
//! - [`OidcSharedConfig`] — shared OIDC provider connectivity config
//! - [`BackendConfigError`] — unified config resolution error
//! - Infrastructure re-exports (provider, OIDC client, resource server)
//!
//! Adopters working with mode-specific config resolution should start here
//! for shared defaults, then use the appropriate `*_mode` module for
//! mode-specific config types.

// Re-export shared-defaults core so adopters don't need to depend on
// securitydept-oauth-provider directly.
pub use securitydept_oauth_provider::OidcSharedConfig;
// Re-export infrastructure types that adopters commonly need during
// config resolution — both configuration and runtime.
pub use securitydept_oauth_provider::{OAuthProviderConfig, OAuthProviderRuntime};
pub use securitydept_oauth_resource_server::{
    OAuthResourceServerConfig, OAuthResourceServerIntrospectionConfig,
};
pub use securitydept_oidc_client::{
    OidcClient, OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig,
};

// ---------------------------------------------------------------------------
// Unified config resolution error
// ---------------------------------------------------------------------------

/// Unified error for backend config resolution across all modes.
///
/// Each variant identifies which sub-config caused the failure, enabling
/// adopters to produce clear diagnostics without matching on mode-specific
/// error types.
#[derive(Debug)]
pub enum BackendConfigError {
    OidcClient(securitydept_oidc_client::OidcError),
    ResourceServer(securitydept_oauth_resource_server::OAuthResourceServerError),
    BackendOidcMediatedModeRuntime(
        crate::backend_oidc_mediated_mode::BackendOidcMediatedModeRuntimeError,
    ),
    TokenPropagation(crate::access_token_substrate::TokenPropagatorError),
}

impl std::fmt::Display for BackendConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OidcClient(e) => write!(f, "oidc_client config: {e}"),
            Self::ResourceServer(e) => write!(f, "oauth_resource_server config: {e}"),
            Self::BackendOidcMediatedModeRuntime(e) => write!(f, "mediated_runtime: {e}"),
            Self::TokenPropagation(e) => write!(f, "token_propagation config: {e}"),
        }
    }
}

impl std::error::Error for BackendConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::OidcClient(e) => Some(e),
            Self::ResourceServer(e) => Some(e),
            Self::BackendOidcMediatedModeRuntime(e) => Some(e),
            Self::TokenPropagation(e) => Some(e),
        }
    }
}

impl From<securitydept_oidc_client::OidcError> for BackendConfigError {
    fn from(e: securitydept_oidc_client::OidcError) -> Self {
        Self::OidcClient(e)
    }
}

impl From<securitydept_oauth_resource_server::OAuthResourceServerError> for BackendConfigError {
    fn from(e: securitydept_oauth_resource_server::OAuthResourceServerError) -> Self {
        Self::ResourceServer(e)
    }
}

impl From<crate::backend_oidc_mediated_mode::BackendOidcMediatedModeRuntimeError>
    for BackendConfigError
{
    fn from(e: crate::backend_oidc_mediated_mode::BackendOidcMediatedModeRuntimeError) -> Self {
        Self::BackendOidcMediatedModeRuntime(e)
    }
}
