//! Backend OIDC mode family — unified product surface.
//!
//! This module organizes the backend OIDC integration modes as a single
//! adopter-facing entry point, symmetric with the frontend
//! `token-set-context-client` SDK.
//!
//! # Mode entries
//!
//! | Mode | Raw config | Resolved config | When to use |
//! |---|---|---|---|
//! | `backend-oidc-pure` | [`BackendOidcPureRawConfig`] | [`BackendOidcPureConfig`] | Standard OIDC client + resource-server; no sealed refresh or mediation |
//! | `backend-oidc-mediated` | [`BackendOidcMediatedRawConfig`] | [`BackendOidcMediatedConfig`] | Enhanced OIDC with sealed refresh, metadata redemption, token propagation |
//!
//! Both modes share the same `[oidc]` shared-defaults resolution pipeline
//! and the same `resolve_config()` entry point pattern:
//!
//! ```text
//! [oidc]                      ──┐
//! [oidc_client]               ──┤
//! [oauth_resource_server]     ──┼──▸ resolve_config() ──▸ validated config bundle
//! [mediated_context]  (*)    ──┘    (* mediated only)
//! ```
//!
//! # Recommended loading path
//!
//! ```rust,ignore
//! use securitydept_token_set_context::backend::{
//!     BackendOidcPureRawConfig,   // or BackendOidcMediatedRawConfig
//!     OidcSharedConfig,
//! };
//!
//! let shared: OidcSharedConfig = /* deserialize [oidc] */;
//! let raw: BackendOidcPureRawConfig<PC> = /* deserialize config */;
//! let config = raw.resolve_config(&shared)?;
//! ```

mod mediated;
mod pure;

pub use mediated::{BackendOidcMediatedConfig, BackendOidcMediatedRawConfig};
pub use pure::{BackendOidcPureConfig, BackendOidcPureRawConfig};

// Re-export shared-defaults core so adopters don't need to depend on
// securitydept-oauth-provider directly.
pub use securitydept_oauth_provider::OidcSharedConfig;

// Re-export infrastructure types that adopters commonly need when working
// with the resolved configs — both configuration and runtime.
pub use securitydept_oauth_provider::{OAuthProviderConfig, OAuthProviderRuntime};
pub use securitydept_oauth_resource_server::{
    OAuthResourceServerConfig, OAuthResourceServerIntrospectionConfig,
    // Verifier runtime — the main runtime entry for token verification.
    OAuthResourceServerVerifier,
    // Verified token models adopters consume after verification.
    ResourceTokenPrincipal, VerificationPolicy, VerifiedAccessToken, VerifiedToken,
};
pub use securitydept_oidc_client::{
    OidcClient, OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig,
};

/// Unified error for backend config resolution across all modes.
///
/// Each variant identifies which sub-config caused the failure, enabling
/// adopters to produce clear diagnostics without matching on mode-specific
/// error types.
#[derive(Debug)]
pub enum BackendConfigError {
    OidcClient(securitydept_oidc_client::OidcError),
    ResourceServer(securitydept_oauth_resource_server::OAuthResourceServerError),
    MediatedContext(crate::MediatedContextError),
}

impl std::fmt::Display for BackendConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OidcClient(e) => write!(f, "oidc_client config: {e}"),
            Self::ResourceServer(e) => write!(f, "oauth_resource_server config: {e}"),
            Self::MediatedContext(e) => write!(f, "mediated_context: {e}"),
        }
    }
}

impl std::error::Error for BackendConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::OidcClient(e) => Some(e),
            Self::ResourceServer(e) => Some(e),
            Self::MediatedContext(e) => Some(e),
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

impl From<crate::MediatedContextError> for BackendConfigError {
    fn from(e: crate::MediatedContextError) -> Self {
        Self::MediatedContext(e)
    }
}
