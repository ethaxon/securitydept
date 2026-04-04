//! `backend-oidc-pure` mode — config resolution + frontend-facing contracts.
//!
//! In a `backend-oidc-pure` deployment the backend runs a standard OIDC client
//! plus resource-server token verification. The frontend receives tokens via
//! the orchestration substrate.
//!
//! This module provides:
//!
//! - [`BackendOidcPureRawConfig`] / [`BackendOidcPureConfig`] — config pair
//! - Mode-qualified model aliases consumed by the TS SDK

mod config;

// --- Public re-exports: config ---

pub use config::{BackendOidcPureConfig, BackendOidcPureRawConfig};

// --- Mode-qualified model aliases ---

/// Auth-state snapshot for `backend-oidc-pure` mode.
pub type BackendOidcPureModeAuthStateSnapshot = crate::models::AuthStateSnapshot;
/// Auth-state delta for `backend-oidc-pure` mode.
pub type BackendOidcPureModeAuthStateDelta = crate::models::AuthStateDelta;
/// Auth-token snapshot for `backend-oidc-pure` mode.
pub type BackendOidcPureModeAuthTokenSnapshot = crate::models::AuthTokenSnapshot;
/// Auth-token delta for `backend-oidc-pure` mode.
pub type BackendOidcPureModeAuthTokenDelta = crate::models::AuthTokenDelta;
