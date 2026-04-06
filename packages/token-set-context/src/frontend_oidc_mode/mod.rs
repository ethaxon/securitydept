//! `frontend-oidc` mode — config, runtime, service, capabilities, and
//! cross-boundary contracts.
//!
//! In a `frontend-oidc` deployment the browser handles the full OIDC
//! authorization code flow (via `oauth4webapi` or similar). The Rust backend
//! does not run the OIDC redirect/callback/token-exchange flow itself.
//!
//! # Module structure
//!
//! - [`contracts`] — config projection, token material, mode-qualified model
//!   aliases
//! - [`capabilities`] / [`FrontendOidcModeCapabilities`] /
//!   [`UnsafeFrontendClientSecret`] — opt-in unsafe features
//! - [`config`] / [`FrontendOidcModeConfig`] /
//!   [`ResolvedFrontendOidcModeConfig`] / [`FrontendOidcModeConfigSource`] —
//!   config
//! - [`runtime`] / [`FrontendOidcModeRuntime`] — runtime (projection helpers)
//! - [`service`] / [`FrontendOidcModeService`] — route-facing service
//!
//! # Substrate integration
//!
//! Token verification and propagation are substrate concerns owned by
//! [`access_token_substrate`](crate::access_token_substrate). This mode
//! provides the contracts that describe how frontend-produced tokens are
//! consumed by the substrate, but does not own the verification or
//! propagation logic itself.

pub mod capabilities;
pub mod config;
pub mod contracts;
pub mod runtime;
pub mod service;

// --- Public re-exports: capabilities ---
pub use capabilities::{FrontendOidcModeCapabilities, UnsafeFrontendClientSecret};
// --- Public re-exports: config ---
pub use config::{
    FrontendOidcModeConfig, FrontendOidcModeConfigSource, NoPendingStoreConfig,
    ResolvedFrontendOidcModeConfig,
};
// --- Public re-exports: contracts ---
pub use contracts::{FrontendOidcModeClaimsCheckScript, FrontendOidcModeConfigProjection};
// --- Public re-exports: runtime ---
pub use runtime::FrontendOidcModeRuntime;
// --- Public re-exports: service ---
pub use service::FrontendOidcModeService;
