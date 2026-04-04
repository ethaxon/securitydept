//! `frontend-oidc` mode — config + integration contracts.
//!
//! In a `frontend-oidc` deployment the browser handles the full OIDC
//! authorization code flow (via `oauth4webapi`). The Rust backend does not
//! run the OIDC redirect/callback/token-exchange flow itself, but this
//! module still provides:
//!
//! - Mode-qualified model aliases consumed by the TS SDK
//! - Future: integration contracts with
//!   [`access_token_substrate`](crate::access_token_substrate) for
//!   mode-qualified resource verification and propagation

// Mode-qualified model aliases.
//
// These are defined here—not re-exported from an internal module—so that
// this canonical module is the source-of-truth for frontend-oidc adopters.

/// Auth-state snapshot for `frontend-oidc` mode.
pub type FrontendOidcModeAuthStateSnapshot = crate::models::AuthStateSnapshot;
/// Auth-state delta for `frontend-oidc` mode.
pub type FrontendOidcModeAuthStateDelta = crate::models::AuthStateDelta;
/// Auth-token snapshot for `frontend-oidc` mode.
pub type FrontendOidcModeAuthTokenSnapshot = crate::models::AuthTokenSnapshot;
/// Auth-token delta for `frontend-oidc` mode.
pub type FrontendOidcModeAuthTokenDelta = crate::models::AuthTokenDelta;
