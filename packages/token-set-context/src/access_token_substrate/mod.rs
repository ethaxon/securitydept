//! Shared access-token substrate — cross-mode runtime infrastructure.
//!
//! This module **owns** capabilities that depend only on a verified access
//! token and `X-SecurityDept-Propagation`, regardless of which OIDC mode
//! originally produced the token.
//!
//! # Capability axes
//!
//! - **`token_propagation`** — `disabled` vs `enabled` (downstream bearer
//!   propagation substrate)
//!
//! # Submodules
//!
//! | Submodule | Description |
//! |---|---|
//! | [`capabilities`] | Substrate capability axes (`TokenPropagation`) |
//! | [`config`] | `AccessTokenSubstrateConfig` |
//! | [`runtime`] | `AccessTokenSubstrateRuntime` — single authority for substrate runtime objects |
//! | [`propagation`] | Destination-policy gated bearer propagation |
//! | [`forwarder`] | Propagation forwarder traits (`PropagationForwarderConfigSource`, `PropagationForwarder`, `PropagationForwarderError`) + axum reverse-proxy forwarder (feature-gated) |
//!
//! # Resource-server types
//!
//! Key resource-server types from `securitydept-oauth-resource-server` are
//! re-exported here so adopters do not need a direct dependency:
//!
//! - [`ResourceTokenPrincipal`]
//! - [`VerifiedAccessToken`], [`VerifiedToken`]
//! - [`VerificationPolicy`]
//! - [`OAuthResourceServerVerifier`]

// --- Own submodules (physically live here) ---

pub mod capabilities;
pub mod config;
pub(crate) mod forwarder;
pub(crate) mod propagation;
pub mod runtime;
mod service;

// --- Capabilities public re-exports ---
pub use capabilities::{TokenPropagation, TokenPropagationKind};
// --- Config public re-exports ---
pub use config::{
    AccessTokenSubstrateConfig, AccessTokenSubstrateConfigSource,
    ResolvedAccessTokenSubstrateConfig,
};
// --- Axum concrete forwarder re-exports (feature-gated) ---
#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
pub use forwarder::{
    AxumReverseProxyPropagationForwarder, AxumReverseProxyPropagationForwarderConfig,
};
// --- Forwarder trait + error re-exports (always available) ---
pub use forwarder::{
    PropagationForwarder, PropagationForwarderConfigSource, PropagationForwarderError,
    PropagationForwarderResult,
};
// --- Propagation public re-exports ---
pub use propagation::{
    AllowedPropagationTarget, BearerPropagationPolicy, DEFAULT_PROPAGATION_HEADER_NAME,
    PropagatedBearer, PropagatedTokenValidationConfig, PropagationDestinationPolicy,
    PropagationDirective, PropagationNodeTargetResolver, PropagationRequestTarget,
    PropagationScheme, TokenPropagator, TokenPropagatorConfig, TokenPropagatorError,
    TokenPropagatorResult,
};
// --- Runtime public re-exports ---
pub use runtime::{AccessTokenSubstrateRuntime, AccessTokenSubstrateRuntimeError};
// --- Resource-server re-exports ---
pub use securitydept_oauth_resource_server::{
    OAuthResourceServerVerifier, ResourceTokenPrincipal, VerificationPolicy, VerifiedAccessToken,
    VerifiedToken,
};
// --- Service public re-exports ---
pub use service::{AccessTokenSubstrateResourceService, AccessTokenSubstrateResourceServiceError};
