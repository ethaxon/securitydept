//! Configuration types for `frontend-oidc` mode.
//!
//! This module mirrors the formal config pattern established by
//! [`backend_oidc_mode::config`](crate::backend_oidc_mode::config):
//!
//! - [`FrontendOidcModeConfig`] — raw input (deserializable from TOML/env)
//! - [`ResolvedFrontendOidcModeConfig`] — validated bundle
//! - [`FrontendOidcModeConfigSource`] — trait for config providers
//!
//! # Relationship with `OidcClientRawConfig`
//!
//! Both `backend-oidc` and `frontend-oidc` modes reuse
//! `OidcClientRawConfig<PC>` as the OIDC client config component. The key
//! difference is:
//!
//! - `backend-oidc` uses a real `PendingOauthStoreConfig` implementation (e.g.
//!   moka) because the backend runs the full OIDC flow.
//! - `frontend-oidc` uses [`NoPendingStoreConfig`] — a no-op implementation —
//!   because the browser owns the OIDC flow. The `OidcClientRawConfig` is used
//!   only to project config to the frontend and to share `[oidc]` defaults.

use securitydept_oauth_provider::OidcSharedConfig;
use serde::Deserialize;

use super::{
    capabilities::FrontendOidcModeCapabilities,
    contracts::{FrontendOidcModeClaimsCheckScript, FrontendOidcModeConfigProjection},
};
use crate::orchestration::{BackendConfigError, OidcClientConfig, OidcClientRawConfig};

// ---------------------------------------------------------------------------
// No-op pending store config (frontend-oidc never runs OIDC flows)
// ---------------------------------------------------------------------------

/// No-op pending store config for `frontend-oidc` mode.
///
/// In `frontend-oidc` mode the browser owns the OIDC flow, so the backend
/// never stores pending OAuth state (nonce, PKCE verifier). This type
/// satisfies the `PendingOauthStoreConfig` bound on `OidcClientRawConfig`
/// without adding any configuration surface.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct NoPendingStoreConfig;

impl securitydept_oidc_client::PendingOauthStoreConfig for NoPendingStoreConfig {}

// ---------------------------------------------------------------------------
// Config source trait
// ---------------------------------------------------------------------------

/// Trait for types that supply `frontend-oidc` configuration.
///
/// Follows the same pattern as
/// [`BackendOidcModeConfigSource`](crate::backend_oidc_mode::BackendOidcModeConfigSource):
/// implementors expose component-config accessors and gain default `resolve_*`
/// helper methods that apply `[oidc]` shared defaults.
pub trait FrontendOidcModeConfigSource {
    /// Access the OIDC client raw config (public-client subset).
    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<NoPendingStoreConfig>;

    /// Access the capability axes.
    fn capabilities(&self) -> &FrontendOidcModeCapabilities;

    /// Resolve OIDC client config by applying shared defaults.
    fn resolve_oidc_client(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<OidcClientConfig<NoPendingStoreConfig>, BackendConfigError> {
        self.oidc_client_raw_config()
            .clone()
            .resolve_config(shared)
            .map_err(Into::into)
    }

    /// **Recommended entry point.** Resolve all frontend-oidc sub-configs
    /// in one step.
    fn resolve_all(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<ResolvedFrontendOidcModeConfig, BackendConfigError> {
        Ok(ResolvedFrontendOidcModeConfig {
            oidc_client: self.resolve_oidc_client(shared)?,
            capabilities: self.capabilities().clone(),
        })
    }
}

// ---------------------------------------------------------------------------
// Raw config (TOML / env deserializable)
// ---------------------------------------------------------------------------

/// Raw configuration for a `frontend-oidc` deployment.
///
/// Reuses `OidcClientRawConfig` (the same OIDC client config vocabulary as
/// `backend-oidc`) with [`NoPendingStoreConfig`] since the frontend owns
/// the OIDC flow. Inherits `[oidc]` shared defaults via the same
/// `resolve_config()` mechanism.
///
/// Capability axes are **flattened** at the top level so they can be
/// configured inline in the same section as OIDC client settings.
///
/// ```text
/// [oidc]
/// well_known_url = "https://auth.example.com/.well-known/openid-configuration"
/// client_id      = "shared-app"
///
/// [frontend_oidc]
/// # OIDC client (inherited from [oidc] if absent)
/// scopes       = ["openid", "profile", "email"]
/// redirect_url = "https://app.example.com/callback"
///
/// # Capability axes
/// unsafe_frontend_client_secret = "disabled"   # default; use "enabled" only as last resort
/// ```
///
/// Note: `client_secret` is accepted by `OidcClientRawConfig` but exposing it
/// to the browser is a security anti-pattern; enable
/// `unsafe_frontend_client_secret` only for broken providers.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct FrontendOidcModeConfig {
    /// OIDC client raw config (public-client subset, no pending-store).
    #[serde(default, flatten)]
    pub oidc_client: OidcClientRawConfig<NoPendingStoreConfig>,

    /// Capability axes controlling opt-in unsafe behaviours.
    #[serde(default, flatten)]
    pub capabilities: FrontendOidcModeCapabilities,
}

impl FrontendOidcModeConfigSource for FrontendOidcModeConfig {
    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<NoPendingStoreConfig> {
        &self.oidc_client
    }

    fn capabilities(&self) -> &FrontendOidcModeCapabilities {
        &self.capabilities
    }
}

// ---------------------------------------------------------------------------
// Resolved (validated) config
// ---------------------------------------------------------------------------

/// Validated configuration bundle for `frontend-oidc` mode.
///
/// Produced by [`FrontendOidcModeConfigSource::resolve_all`]. The
/// `oidc_client` has had `[oidc]` shared defaults applied and passed
/// validation. Capabilities are carried through from the raw config so
/// that `to_config_projection` can apply them without external parameters.
#[derive(Debug, Clone)]
pub struct ResolvedFrontendOidcModeConfig {
    /// Resolved OIDC client config with shared defaults applied.
    pub oidc_client: OidcClientConfig<NoPendingStoreConfig>,
    /// Resolved capability axes.
    pub capabilities: FrontendOidcModeCapabilities,
}

impl ResolvedFrontendOidcModeConfig {
    /// Build a config projection for the frontend.
    ///
    /// - `client_secret` is only included when `UnsafeFrontendClientSecret` is
    ///   enabled in `self.capabilities`.
    /// - `claims_check_script`, if configured, is read from the filesystem and
    ///   embedded inline as [`FrontendOidcModeClaimsCheckScript::Inline`].
    ///
    /// # Errors
    ///
    /// Returns an `io::Error` if the claims check script path is configured but
    /// the file cannot be read or transpiled.
    pub async fn to_config_projection(&self) -> std::io::Result<FrontendOidcModeConfigProjection> {
        let client_secret = if self.capabilities.unsafe_frontend_client_secret.is_enabled() {
            self.oidc_client.client_secret.clone()
        } else {
            None
        };

        // Read the script file from the filesystem and inline it.
        let claims_check_script = match self.oidc_client.claims_check_script.as_deref() {
            Some(path) => Some(FrontendOidcModeClaimsCheckScript::from_path(path).await?),
            None => None,
        };

        Ok(FrontendOidcModeConfigProjection {
            // Provider connectivity
            well_known_url: self.oidc_client.remote.well_known_url.clone(),
            issuer_url: self.oidc_client.remote.issuer_url.clone(),
            jwks_uri: self.oidc_client.remote.jwks_uri.clone(),
            metadata_refresh_interval: self.oidc_client.remote.metadata_refresh_interval,
            jwks_refresh_interval: self.oidc_client.remote.jwks_refresh_interval,
            // Provider OIDC endpoints
            authorization_endpoint: self
                .oidc_client
                .provider_oidc
                .authorization_endpoint
                .clone(),
            token_endpoint: self.oidc_client.provider_oidc.token_endpoint.clone(),
            userinfo_endpoint: self.oidc_client.provider_oidc.userinfo_endpoint.clone(),
            revocation_endpoint: self.oidc_client.provider_oidc.revocation_endpoint.clone(),
            token_endpoint_auth_methods_supported: self
                .oidc_client
                .provider_oidc
                .token_endpoint_auth_methods_supported
                .as_ref()
                .map(|v| {
                    v.iter()
                        .filter_map(|a| serde_json::to_value(a).ok())
                        .filter_map(|v| v.as_str().map(|s| s.to_owned()))
                        .collect()
                }),
            id_token_signing_alg_values_supported: self
                .oidc_client
                .provider_oidc
                .id_token_signing_alg_values_supported
                .as_ref()
                .map(|v| {
                    v.iter()
                        .filter_map(|a| serde_json::to_value(a).ok())
                        .filter_map(|v| v.as_str().map(|s| s.to_owned()))
                        .collect()
                }),
            userinfo_signing_alg_values_supported: self
                .oidc_client
                .provider_oidc
                .userinfo_signing_alg_values_supported
                .as_ref()
                .map(|v| {
                    v.iter()
                        .filter_map(|a| serde_json::to_value(a).ok())
                        .filter_map(|v| v.as_str().map(|s| s.to_owned()))
                        .collect()
                }),

            // Client settings
            client_id: self.oidc_client.client_id.clone(),
            client_secret,
            scopes: self.oidc_client.scopes.clone(),
            required_scopes: self.oidc_client.required_scopes.clone(),
            redirect_url: self.oidc_client.redirect_url.clone(),
            pkce_enabled: self.oidc_client.pkce_enabled,
            claims_check_script,
            generated_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};

    use super::*;

    fn shared_config() -> OidcSharedConfig {
        OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            client_secret: Some("shared-secret".to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn resolve_inherits_client_id_from_shared() {
        let raw = FrontendOidcModeConfig::default();
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(resolved.oidc_client.client_id, "shared-app");
    }

    #[test]
    fn local_client_id_overrides_shared() {
        let raw = FrontendOidcModeConfig {
            oidc_client: OidcClientRawConfig {
                client_id: Some("local-spa".to_string()),
                ..Default::default()
            },
            capabilities: Default::default(),
        };
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(resolved.oidc_client.client_id, "local-spa");
    }

    #[test]
    fn resolve_inherits_well_known_url_from_shared() {
        let raw = FrontendOidcModeConfig::default();
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(
            resolved.oidc_client.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration"),
        );
    }

    #[test]
    fn resolve_fails_without_client_id() {
        let shared = OidcSharedConfig::default();
        let raw = FrontendOidcModeConfig::default();
        let err = raw.resolve_all(&shared).unwrap_err();
        assert!(err.to_string().contains("client_id must be set"));
    }

    #[tokio::test]
    async fn projection_reflects_resolved_config() {
        let raw = FrontendOidcModeConfig {
            oidc_client: OidcClientRawConfig {
                redirect_url: Some("https://app.example.com/callback".to_string()),
                pkce_enabled: true,
                ..Default::default()
            },
            capabilities: Default::default(),
        };
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        let projection = resolved
            .to_config_projection()
            .await
            .expect("projection should succeed");

        assert_eq!(
            projection.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration")
        );
        assert_eq!(projection.client_id, "shared-app");
        assert_eq!(projection.redirect_url, "https://app.example.com/callback");
        assert!(projection.pkce_enabled);
        // client_secret NOT exposed by default
        assert!(projection.client_secret.is_none());
        // Endpoint overrides default to None (derived from discovery)
        assert!(projection.authorization_endpoint.is_none());
        assert!(projection.token_endpoint.is_none());
        assert!(projection.userinfo_endpoint.is_none());
    }

    #[test]
    fn default_scopes_applied() {
        let raw = FrontendOidcModeConfig::default();
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(
            resolved.oidc_client.scopes,
            vec![
                "openid".to_string(),
                "profile".to_string(),
                "email".to_string()
            ]
        );
    }
}
