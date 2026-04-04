//! `backend-oidc-mediated` mode — full runtime + frontend-facing contracts.
//!
//! This is the canonical adopter-facing entry for `backend-oidc-mediated`.
//! All public types for this mode are accessed through this module.
//!
//! # Runtime
//!
//! - [`BackendOidcMediatedModeRuntime`] — core mode runtime (OIDC + sealed
//!   refresh)
//! - [`BackendOidcMediatedModeRuntimeConfig`] — runtime configuration
//! - [`BackendOidcMediatedModeRuntimeError`] /
//!   [`BackendOidcMediatedModeRuntimeResult`] — error types
//!
//! # Config resolution
//!
//! - [`BackendOidcMediatedConfig`] / [`ResolvedBackendOidcMediatedConfig`] —
//!   combined raw/resolved config
//!
//! # Capabilities
//!
//! - Metadata redemption (`MetadataRedemptionId`, pending store traits)
//! - Sealed refresh material (`AeadRefreshMaterialProtector`,
//!   `SealedRefreshMaterial`)
//! - Redirect URI resolution (`TokenSetRedirectUriResolver`,
//!   `TokenSetRedirectUriRule`)
//! - Frontend-facing transport contracts (authorize query, refresh payload,
//!   etc.)
//!
//! Token propagation, forwarder, and resource-server verification are
//! cross-mode shared and live in
//! [`access_token_substrate`](crate::access_token_substrate).

// --- Internal submodules (mode-specific, physically live here) ---

pub(crate) mod config;
pub(crate) mod error;
pub(crate) mod metadata_redemption;
pub(crate) mod redirect;
pub(crate) mod refresh_material;
pub(crate) mod runtime;
mod service;
mod transport;

// --- Public re-exports: config resolution ---

pub use config::{
    BackendOidcMediatedConfig, BackendOidcMediatedConfigSource, ResolvedBackendOidcMediatedConfig,
};
// --- Public re-exports: error ---
pub use error::{BackendOidcMediatedModeRuntimeError, BackendOidcMediatedModeRuntimeResult};
// --- Public re-exports: metadata redemption ---
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
// --- Public re-exports: redirect ---
pub use redirect::{
    TokenSetRedirectUriConfig, TokenSetRedirectUriError, TokenSetRedirectUriResolver,
    TokenSetRedirectUriRule,
};
// --- Public re-exports: refresh material ---
pub use refresh_material::{
    AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector, RefreshMaterialError,
    RefreshMaterialProtector, SealedRefreshMaterial,
};
// --- Public re-exports: OIDC helpers ---
pub use runtime::OidcAuthStateOptions;
// --- Public re-exports: runtime ---
pub use runtime::{
    BackendOidcMediatedModeCodeCallbackResult, BackendOidcMediatedModeRuntime,
    BackendOidcMediatedModeRuntimeConfig, BackendOidcMediatedModeTokenRefreshResult,
};
// --- Public re-exports: service ---
pub use service::BackendOidcMediatedModeAuthService;
// --- Public re-exports: frontend-facing transport contracts ---
pub use transport::{
    AuthTokenDeltaRedirectFragment, AuthTokenSnapshotRedirectFragment, MetadataRedemptionRequest,
    MetadataRedemptionResponse, TokenRefreshPayload, TokenSetAuthorizeQuery,
};
