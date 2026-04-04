//! # securitydept-token-set-context
//!
//! **Unified product surface** for the securitydept OIDC mode family,
//! symmetric with the frontend `token-set-context-client` TS SDK.
//!
//! ## Canonical public surface
//!
//! | Module | Description |
//! |---|---|
//! | [`frontend_oidc_mode`] | Frontend pure OIDC — config + integration contracts |
//! | [`backend_oidc_pure_mode`] | Standard backend OIDC — config + frontend-facing contracts |
//! | [`backend_oidc_mediated_mode`] | Backend-mediated OIDC — [`BackendOidcMediatedModeRuntime`](backend_oidc_mediated_mode::BackendOidcMediatedModeRuntime) + transport contracts |
//! | [`access_token_substrate`] | Cross-mode shared substrate: propagation, forwarder, resource-server |
//! | [`orchestration`] | Cross-mode shared config, OIDC client, provider infrastructure |
//! | [`models`] | Shared auth-state data models |
//!
//! ## Entry point
//!
//! Adopters should enter via the appropriate `*_mode` module for their
//! deployment topology, use [`orchestration`] for shared config resolution,
//! and [`access_token_substrate`] for token verification and propagation.

// --- Canonical public modules ---

pub mod access_token_substrate;
pub mod backend_oidc_mediated_mode;
pub mod backend_oidc_pure_mode;
pub mod frontend_oidc_mode;
pub mod models;
pub mod orchestration;

#[cfg(test)]
mod tests;
