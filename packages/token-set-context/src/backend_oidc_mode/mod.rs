//! `backend-oidc` mode — unified backend OIDC capability framework.
//!
//! This is the **canonical adopter-facing entry** for all backend OIDC
//! deployments.
//!
//! # Capability axes
//!
//! The behaviour of `backend-oidc` is parameterized by three capability axes:
//!
//! - **`refresh_material_protection`** — `passthrough` (plain) vs `sealed`
//!   (AEAD-encrypted)
//! - **`metadata_delivery`** — `none` vs `redemption` (one-time redemption id)
//! - **`post_auth_redirect_policy`** — `caller_validated` (no service policy)
//!   vs `resolved` (runtime allowlist)
//!
//! # Presets
//!
//! Two canonical presets configure common capability bundles:
//!
//! | Preset | Refresh | Metadata | Redirect |
//! |---|---|---|---|
//! | `Pure` | passthrough | none | caller_validated |
//! | `Mediated` | sealed | redemption | resolved |
//!
//! # Module structure
//!
//! - [`capabilities`] — capability axes, composite capabilities, named presets
//! - [`config`] / [`ResolvedBackendOidcModeConfig`] /
//!   [`BackendOidcModeConfigSource`] — config
//! - [`metadata_redemption`] — one-time metadata redemption store trait +
//!   implementations
//! - [`redirect`] — post-auth redirect URI resolver
//! - [`refresh_material`] — sealed refresh material protector trait +
//!   implementations
//! - [`runtime`] — unified runtime (authorize / callback / refresh / metadata
//!   redemption)
//! - [`service`] — unified route-facing auth service
//! - [`transport`] — canonical contract vocabulary (fragments, payloads, user
//!   info, metadata redemption)

pub mod capabilities;
pub mod config;
pub mod metadata_redemption;
pub mod redirect;
pub mod refresh_material;
pub mod runtime;
pub mod service;
pub mod transport;

// --- Public re-exports: capabilities ---

pub use capabilities::{
    BackendOidcModeCapabilities, BackendOidcModePreset, MetadataDelivery, MetadataDeliveryKind,
    PostAuthRedirectPolicy, PostAuthRedirectPolicyKind, RefreshMaterialProtection,
    RefreshMaterialProtectionKind,
};
// --- Public re-exports: config ---
pub use config::{
    BackendOidcModeConfig, BackendOidcModeConfigSource, ResolvedBackendOidcModeConfig,
};
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
// --- Public re-exports: never metadata store (for pure preset) ---
pub use metadata_redemption::{NeverMetadataRedemptionConfig, NeverMetadataRedemptionStore};
// --- Public re-exports: redirect ---
pub use redirect::{
    BackendOidcModeRedirectUriConfig, BackendOidcModeRedirectUriError,
    BackendOidcModeRedirectUriResolver, BackendOidcModeRedirectUriRule,
};
// --- Public re-exports: refresh material ---
pub use refresh_material::{
    AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector, RefreshMaterialError,
    RefreshMaterialProtector, SealedRefreshMaterial,
};
// --- Public re-exports: runtime ---
pub use runtime::{
    BackendOidcModeAuthStateOptions, BackendOidcModeCodeCallbackResult, BackendOidcModeRuntime,
    BackendOidcModeRuntimeConfig, BackendOidcModeRuntimeError, BackendOidcModeRuntimeResult,
    BackendOidcModeTokenRefreshResult,
};
// --- Public re-exports: service ---
pub use service::BackendOidcModeAuthService;
// --- Public re-exports: transport ---
pub use transport::{
    BackendOidcModeAuthorizeQuery, BackendOidcModeCallbackFragment,
    BackendOidcModeMetadataRedemptionRequest, BackendOidcModeMetadataRedemptionResponse,
    BackendOidcModeRefreshFragment, BackendOidcModeRefreshPayload, BackendOidcModeUserInfoRequest,
    BackendOidcModeUserInfoResponse,
};
