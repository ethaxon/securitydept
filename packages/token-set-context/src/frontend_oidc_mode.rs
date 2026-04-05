//! `frontend-oidc` mode — config projection + integration contracts.
//!
//! In a `frontend-oidc` deployment the browser handles the full OIDC
//! authorization code flow (via `oauth4webapi` or similar). The Rust backend
//! does not run the OIDC redirect/callback/token-exchange flow itself.
//!
//! This module provides:
//!
//! # Config projection
//!
//! - [`FrontendOidcModeConfigProjection`] — the backend projects a subset of
//!   its OIDC configuration to the frontend so the browser client can discover
//!   and connect to the same provider.
//!
//! # Integration contracts
//!
//! - [`FrontendOidcModeIntegrationRequirement`] — describes what the backend
//!   and shared [`access_token_substrate`](crate::access_token_substrate)
//!   expect from frontend-produced tokens (required audiences, issuer
//!   constraint, etc.).
//! - [`FrontendOidcModeTokenMaterial`] — the minimal token material that the
//!   frontend must provide for the backend to validate via
//!   `access_token_substrate`.
//!
//! # Mode-qualified model aliases
//!
//! - [`FrontendOidcModeAuthStateSnapshot`] / [`FrontendOidcModeAuthStateDelta`]
//! - [`FrontendOidcModeAuthTokenSnapshot`] / [`FrontendOidcModeAuthTokenDelta`]

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Config projection
// ---------------------------------------------------------------------------

/// Backend-to-frontend OIDC configuration projection.
///
/// When a deployment uses `frontend-oidc` mode, the backend must tell the
/// browser client *which* OIDC provider to talk to and *how*. This struct
/// captures the minimal projection that the backend exposes (e.g. via a
/// `/api/auth/config` endpoint) so the frontend can initialize its own
/// OIDC client.
///
/// This is intentionally a **projection**, not the full backend config — it
/// omits `client_secret` and server-side-only settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrontendOidcModeConfigProjection {
    /// OIDC discovery URL (e.g. `https://auth.example.com/.well-known/openid-configuration`).
    pub well_known_url: String,
    /// The `client_id` the frontend should use for authorization requests.
    pub client_id: String,
    /// Scopes the frontend should request (e.g. `["openid", "profile",
    /// "email"]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scopes: Vec<String>,
    /// The redirect URL the frontend should use for the OIDC callback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Integration requirement
// ---------------------------------------------------------------------------

/// Describes what the backend expects from frontend-produced tokens.
///
/// When the frontend completes an OIDC flow and obtains tokens, it presents
/// the access token to the backend via `Authorization: Bearer <token>`.
/// This struct encodes the **requirements** that the backend's
/// [`access_token_substrate`](crate::access_token_substrate) will enforce
/// when verifying those tokens.
///
/// Adopters can expose this via a discovery endpoint so the frontend client
/// knows upfront what token constraints to satisfy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct FrontendOidcModeIntegrationRequirement {
    /// Expected audiences in the access token (the resource-server's
    /// `aud` check). Empty means "no audience constraint published."
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_audiences: Vec<String>,
    /// Expected token issuer URL. `None` means "derived from discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_issuer: Option<String>,
    /// Whether the backend requires the access token to be a JWT
    /// (as opposed to an opaque token verified via introspection).
    #[serde(default)]
    pub requires_jwt_access_token: bool,
    /// Whether the backend supports token propagation for this mode.
    #[serde(default)]
    pub supports_propagation: bool,
}

// ---------------------------------------------------------------------------
// Token material
// ---------------------------------------------------------------------------

/// Minimal token material that the frontend produces and the backend consumes.
///
/// In `frontend-oidc` mode, the browser owns the full OIDC lifecycle. When
/// it needs to call a protected backend API, it provides this material.
/// The backend then verifies the access token via
/// [`access_token_substrate`](crate::access_token_substrate).
///
/// This struct is **not** a transport payload — it models the conceptual
/// contract between the frontend OIDC client and the backend resource
/// server / propagation substrate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrontendOidcModeTokenMaterial {
    /// The bearer access token produced by the frontend OIDC flow.
    pub access_token: String,
    /// Optional ID token (if the frontend chooses to forward identity claims).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
}

// ---------------------------------------------------------------------------
// Mode-qualified model aliases
// ---------------------------------------------------------------------------

/// Auth-state snapshot for `frontend-oidc` mode.
pub type FrontendOidcModeAuthStateSnapshot = crate::models::AuthStateSnapshot;
/// Auth-state delta for `frontend-oidc` mode.
pub type FrontendOidcModeAuthStateDelta = crate::models::AuthStateDelta;
/// Auth-token snapshot for `frontend-oidc` mode.
pub type FrontendOidcModeAuthTokenSnapshot = crate::models::AuthTokenSnapshot;
/// Auth-token delta for `frontend-oidc` mode.
pub type FrontendOidcModeAuthTokenDelta = crate::models::AuthTokenDelta;
