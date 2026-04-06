//! # securitydept-token-set-context
//!
//! **Unified product surface** for the securitydept OIDC mode family,
//! symmetric with the frontend `token-set-context-client` TS SDK.
//!
//! ## Canonical public surface
//!
//! | Module | Description |
//! |---|---|
//! | [`backend_oidc_mode`] | **Canonical** — unified backend OIDC capability framework (capabilities, config, runtime, service, transport) |
//! | [`frontend_oidc_mode`] | Frontend OIDC — config, runtime, service, cross-boundary contracts |
//! | [`access_token_substrate`] | Cross-mode shared substrate: resource-server verification, propagation, forwarder |
//! | [`orchestration`] | Cross-mode shared config, OIDC client, provider infrastructure |
//! | [`models`] | Shared auth-state data models |
//!
//! ## Mode relationship
//!
//! - `backend-oidc` is the canonical unified surface. It parameterizes runtime
//!   behaviour through capability axes (`refresh_material_protection`,
//!   `metadata_delivery`, `post_auth_redirect`). Adopters configure the axes
//!   directly — no preset indirection needed.
//! - `frontend-oidc` has no backend OIDC client runtime — the browser owns the
//!   full OIDC lifecycle. This module provides formal config, runtime, and
//!   service patterns alongside cross-boundary contracts describing what the
//!   backend expects from frontend-produced tokens.
//!
//! ## Entry point
//!
//! Adopters should enter via [`backend_oidc_mode`] for new integrations,
//! use [`orchestration`] for shared config resolution, and
//! [`access_token_substrate`] for token verification and propagation.

// --- Canonical public modules ---

pub mod access_token_substrate;
pub mod backend_oidc_mode;
pub mod frontend_oidc_mode;
pub mod models;
pub mod orchestration;

#[cfg(test)]
mod tests;
