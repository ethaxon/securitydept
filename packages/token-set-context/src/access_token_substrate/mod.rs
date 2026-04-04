//! Shared access-token substrate — cross-mode runtime infrastructure.
//!
//! This module **owns** capabilities that depend only on a verified access
//! token and `X-SecurityDept-Propagation`, regardless of which OIDC mode
//! originally produced the token.
//!
//! # Submodules
//!
//! | Submodule | Description |
//! |---|---|
//! | [`propagation`] | Destination-policy gated bearer propagation |
//! | [`forwarder`] | Axum reverse-proxy propagation forwarder (feature-gated) |
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

#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
pub(crate) mod forwarder;
pub(crate) mod propagation;
mod service;

// --- Resource-server re-exports ---

// --- Forwarder public re-exports ---
#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
pub use forwarder::{
    AxumReverseProxyPropagationForwarder, AxumReverseProxyPropagationForwarderConfig,
    AxumReverseProxyPropagationForwarderError, AxumReverseProxyPropagationForwarderResult,
};
// --- Propagation public re-exports ---
pub use propagation::{
    AllowedPropagationTarget, BearerPropagationPolicy, DEFAULT_PROPAGATION_HEADER_NAME,
    PropagatedBearer, PropagatedTokenValidationConfig, PropagationDestinationPolicy,
    PropagationDirective, PropagationNodeTargetResolver, PropagationRequestTarget,
    PropagationScheme, TokenPropagator, TokenPropagatorConfig, TokenPropagatorError,
    TokenPropagatorResult,
};
pub use securitydept_oauth_resource_server::{
    OAuthResourceServerVerifier, ResourceTokenPrincipal, VerificationPolicy, VerifiedAccessToken,
    VerifiedToken,
};
// --- Service public re-exports ---
pub use service::{AccessTokenSubstrateResourceService, AccessTokenSubstrateResourceServiceError};
