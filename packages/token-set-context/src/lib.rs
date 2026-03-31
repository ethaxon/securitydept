//! # securitydept-token-set-context
//!
//! **Unified backend product surface** for the securitydept OIDC mode family,
//! symmetric with the frontend `token-set-context-client` TS SDK.
//!
//! ## Backend modes
//!
//! Enter via the [`backend`] module:
//!
//! | Mode | Entry | Description |
//! |---|---|---|
//! | `backend-oidc-pure` | [`backend::BackendOidcPureRawConfig`] | Standard OIDC client + resource server |
//! | `backend-oidc-mediated` | [`backend::BackendOidcMediatedRawConfig`] | Enhanced OIDC with sealed refresh, metadata redemption, token propagation |
//!
//! Both modes share the same [`backend::OidcSharedConfig`] resolution
//! pipeline and `resolve_config()` entry point pattern.
//!
//! ## Infrastructure crates (implementation layer)
//!
//! The following crates provide the underlying implementations. Adopters
//! typically do not need to depend on them directly — key types are
//! re-exported through [`backend`]:
//!
//! - `securitydept-oauth-provider` — OIDC discovery, JWKS, metadata refresh
//! - `securitydept-oidc-client` — OIDC authorization code / device flows
//! - `securitydept-oauth-resource-server` — JWT verification, introspection

pub mod backend;
mod context;
mod error;
#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
mod forwarder;
mod metadata_redemption;
mod models;
mod oidc;
mod propagation;
mod redirect;
mod refresh_material;
#[cfg(test)]
mod tests;
mod transport;

pub use context::{
    MediatedContext, MediatedContextCodeCallbackResult, MediatedContextConfig,
    MediatedContextTokenRefreshResult,
};
pub use error::{MediatedContextError, MediatedContextResult};
#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
pub use forwarder::{
    AxumReverseProxyPropagationForwarder, AxumReverseProxyPropagationForwarderConfig,
    AxumReverseProxyPropagationForwarderError, AxumReverseProxyPropagationForwarderResult,
};
pub use metadata_redemption::{
    MetadataRedemptionId, PendingAuthStateMetadataRedemption,
    PendingAuthStateMetadataRedemptionConfig, PendingAuthStateMetadataRedemptionPayload,
    PendingAuthStateMetadataRedemptionStore, PendingAuthStateMetadataRedemptionStoreError,
    SerializedPendingAuthStateMetadataRedemption,
};
#[cfg(feature = "moka-pending-store")]
pub use metadata_redemption::{
    MokaPendingAuthStateMetadataRedemptionConfig, MokaPendingAuthStateMetadataRedemptionStore,
};
pub use models::{
    AuthStateDelta, AuthStateMetadataDelta, AuthStateMetadataSnapshot, AuthStateSnapshot,
    AuthTokenDelta, AuthTokenSnapshot, AuthenticatedPrincipal, AuthenticationSource,
    AuthenticationSourceKind, CurrentAuthStateMetadataSnapshotPartial,
    CurrentAuthenticationSourcePartial,
};
pub use oidc::OidcAuthStateOptions;
pub use propagation::{
    AllowedPropagationTarget, BearerPropagationPolicy, DEFAULT_PROPAGATION_HEADER_NAME,
    PropagatedBearer, PropagatedTokenValidationConfig, PropagationDestinationPolicy,
    PropagationDirective, PropagationNodeTargetResolver, PropagationRequestTarget,
    PropagationScheme, TokenPropagator, TokenPropagatorConfig, TokenPropagatorError,
    TokenPropagatorResult,
};
pub use redirect::{
    TokenSetRedirectUriConfig, TokenSetRedirectUriError, TokenSetRedirectUriResolver,
    TokenSetRedirectUriRule,
};
pub use refresh_material::{
    AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector, RefreshMaterialError,
    RefreshMaterialProtector, SealedRefreshMaterial,
};
pub use transport::{
    AuthTokenDeltaRedirectFragment, AuthTokenSnapshotRedirectFragment, MetadataRedemptionRequest,
    MetadataRedemptionResponse, TokenRefreshPayload, TokenSetAuthorizeQuery,
};
