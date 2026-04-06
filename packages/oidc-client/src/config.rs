use openidconnect::core::CoreJwsSigningAlgorithm;
use securitydept_oauth_provider::{
    OAuthProviderConfig, OAuthProviderOidcConfig, OAuthProviderRemoteConfig, OidcSharedConfig,
};
use securitydept_utils::ser::CommaOrSpaceSeparated;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, PickFirst, serde_as};

use crate::{OidcError, OidcResult, PendingOauthStoreConfig};

/// Input configuration for building the OIDC client.
///
/// When `well_known_url` is set, discovery is fetched from it and optional
/// fields override. When not set, `issuer_url`, `authorization_endpoint`,
/// `token_endpoint`, and `jwks_uri` must be set. `userinfo_endpoint` is
/// recommended, and userinfo claims are fetched only when it is set.
///
/// Use [`OidcClientRawConfig::apply_shared_defaults`] when loading from a
/// config source that also provides an `[oidc]` shared-defaults block.
#[serde_as]
#[derive(Debug, Clone, Deserialize)]
pub struct OidcClientConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    /// Shared remote-provider connectivity settings.
    #[serde(flatten)]
    pub remote: OAuthProviderRemoteConfig,
    /// OIDC-specific provider metadata overrides.
    #[serde(flatten)]
    pub provider_oidc: OAuthProviderOidcConfig,
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    /// Scopes that MUST be present in the token endpoint response.
    ///
    /// When non-empty, `exchange_code` and `handle_token_refresh` will verify
    /// that the returned `scope` field covers all entries. An empty list (the
    /// default) disables the check. Can be shared from
    /// `[oidc].required_scopes`.
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default)]
    pub required_scopes: Vec<String>,
    #[serde(default)]
    pub claims_check_script: Option<String>,
    /// When true, use PKCE (code_challenge / code_verifier) for the
    /// authorization code flow.
    #[serde(default)]
    pub pkce_enabled: bool,
    #[serde(default = "default_redirect_url")]
    pub redirect_url: String,
    /// Configuration for the pending OAuth store.
    #[serde(default, bound = "PC: PendingOauthStoreConfig")]
    pub pending_store: Option<PC>,
    /// Default interval to poll the device token endpoint if the provider
    /// doesn't specify one.
    #[serde(default = "default_device_poll_interval", with = "humantime_serde")]
    pub device_poll_interval: std::time::Duration,
}

impl<PC> OidcClientConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    pub fn validate(&self) -> OidcResult<()> {
        if self.claims_check_script.is_some() && cfg!(not(feature = "claims-script")) {
            return Err(OidcError::InvalidConfig {
                message: "Claims check script is enabled but the claims-script feature is disabled"
                    .to_string(),
            });
        }
        if self.remote.well_known_url.is_none() {
            let missing: Vec<&str> = [
                ("issuer_url", self.remote.issuer_url.as_deref()),
                (
                    "authorization_endpoint",
                    self.provider_oidc.authorization_endpoint.as_deref(),
                ),
                (
                    "token_endpoint",
                    self.provider_oidc.token_endpoint.as_deref(),
                ),
                ("jwks_uri", self.remote.jwks_uri.as_deref()),
                (
                    "userinfo_endpoint",
                    self.provider_oidc.userinfo_endpoint.as_deref(),
                ),
            ]
            .into_iter()
            .filter_map(|(name, v)| match v {
                None | Some("") => Some(name),
                Some(s) if s.trim().is_empty() => Some(name),
                _ => None,
            })
            .collect();
            if missing.len() > 1 || (missing.len() == 1 && missing[0] != "userinfo_endpoint") {
                return Err(OidcError::InvalidConfig {
                    message: format!(
                        "When well_known_url is not set, all of issuer_url, \
                         authorization_endpoint, token_endpoint, and jwks_uri must be set; \
                         userinfo_endpoint is recommended and only enables user_info_claims \
                         fetch; missing: {}",
                        missing.join(", ")
                    ),
                });
            }
        }
        Ok(())
    }

    pub fn provider_config(&self) -> OAuthProviderConfig {
        OAuthProviderConfig {
            remote: self.remote.clone(),
            oidc: self.provider_oidc.clone(),
        }
    }
}

/// Raw (pre-resolution) OIDC client configuration that allows optional fields
/// to be filled from an `[oidc]` shared-defaults block.
///
/// Unlike [`OidcClientConfig`], `client_id` here is optional so that it can
/// be omitted from `[oidc_client]` and inherited from `[oidc]` instead.
/// Call [`OidcClientRawConfig::apply_shared_defaults`] to resolve into a
/// validated [`OidcClientConfig`].
///
/// # Resolution order: local > [oidc] shared > hardcoded default
///
/// Supported shared fields (from `[oidc]`):
/// - `well_known_url`, `issuer_url`, `jwks_uri` — true presence-aware
/// - `client_id`, `client_secret` — presence-aware optional credentials
///
/// Shareable from `[oidc]`:
/// - `required_scopes` — presence-aware (local non-empty wins; else shared)
///
/// Not shared (must stay in `[oidc_client]`):
/// - `scopes`, `redirect_url`, `pkce_enabled`, `claims_check_script`
#[serde_as]
#[derive(Debug, Clone, Deserialize)]
pub struct OidcClientRawConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    /// Local `client_id`. If absent, falls back to `[oidc].client_id`.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_id: Option<String>,
    /// Local `client_secret`. If absent, falls back to `[oidc].client_secret`.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_secret: Option<String>,
    /// Local provider connectivity. URL fields fall back to `[oidc]` if absent.
    #[serde(flatten)]
    pub remote: OAuthProviderRemoteConfig,
    /// OIDC-specific overrides (never shared).
    #[serde(flatten)]
    pub provider_oidc: OAuthProviderOidcConfig,
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    /// Scopes that MUST be present in the token endpoint response.
    /// Falls back to `[oidc].required_scopes` when local is empty.
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default)]
    pub required_scopes: Vec<String>,
    #[serde(default)]
    pub claims_check_script: Option<String>,
    #[serde(default)]
    pub pkce_enabled: bool,
    #[serde(default = "default_redirect_url")]
    pub redirect_url: String,
    #[serde(default, bound = "PC: PendingOauthStoreConfig")]
    pub pending_store: Option<PC>,
    #[serde(default = "default_device_poll_interval", with = "humantime_serde")]
    pub device_poll_interval: std::time::Duration,
}

impl<PC> OidcClientRawConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    /// Apply shared defaults from an `[oidc]` block and produce the final
    /// [`OidcClientConfig`]. Returns an error if `client_id` cannot be
    /// resolved (neither local nor shared has a value).
    pub fn apply_shared_defaults(
        self,
        shared: &OidcSharedConfig,
    ) -> OidcResult<OidcClientConfig<PC>> {
        let resolved_client_id = shared
            .resolve_client_id(self.client_id.as_deref())
            .ok_or_else(|| OidcError::InvalidConfig {
                message: "client_id must be set in either [oidc_client] or [oidc]".to_string(),
            })?;

        Ok(OidcClientConfig {
            client_id: resolved_client_id,
            client_secret: shared.resolve_client_secret(self.client_secret.as_deref()),
            remote: shared.resolve_remote(&self.remote),
            provider_oidc: self.provider_oidc,
            scopes: self.scopes,
            required_scopes: shared.resolve_required_scopes(&self.required_scopes),
            claims_check_script: self.claims_check_script,
            pkce_enabled: self.pkce_enabled,
            redirect_url: self.redirect_url,
            pending_store: self.pending_store,
            device_poll_interval: self.device_poll_interval,
        })
    }

    /// **Recommended entry point.** Resolve shared defaults and validate in
    /// one step.
    ///
    /// Equivalent to `self.apply_shared_defaults(shared)?.validate()` but
    /// returns the validated config directly, eliminating manual glue.
    ///
    /// ```text
    /// [oidc]          ──┐
    ///                   ├──▸ resolve_config() ──▸ validated OidcClientConfig
    /// [oidc_client]   ──┘
    /// ```
    pub fn resolve_config(self, shared: &OidcSharedConfig) -> OidcResult<OidcClientConfig<PC>> {
        let config = self.apply_shared_defaults(shared)?;
        config.validate()?;
        Ok(config)
    }
}

impl<PC> Default for OidcClientRawConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    fn default() -> Self {
        Self {
            client_id: None,
            client_secret: None,
            remote: OAuthProviderRemoteConfig::default(),
            provider_oidc: OAuthProviderOidcConfig::default(),
            scopes: default_scopes(),
            required_scopes: vec![],
            claims_check_script: None,
            pkce_enabled: false,
            redirect_url: default_redirect_url(),
            pending_store: None,
            device_poll_interval: default_device_poll_interval(),
        }
    }
}

pub fn default_scopes() -> Vec<String> {
    vec![
        "openid".to_string(),
        "profile".to_string(),
        "email".to_string(),
    ]
}

pub fn default_id_token_signing_alg_values_supported() -> Vec<CoreJwsSigningAlgorithm> {
    vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256]
}

pub fn default_redirect_url() -> String {
    "/auth/callback".to_string()
}

pub fn default_device_poll_interval() -> std::time::Duration {
    std::time::Duration::from_secs(5)
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};
    use serde::Deserialize;

    use super::{OidcClientRawConfig, default_scopes};
    use crate::pending_store::base::PendingOauthStoreConfig;

    // Minimal no-op config for tests — avoids feature-gated moka dependency.
    #[derive(Debug, Clone, Default, Deserialize)]
    struct TestPendingStoreConfig;
    impl PendingOauthStoreConfig for TestPendingStoreConfig {}

    type RawConfig = OidcClientRawConfig<TestPendingStoreConfig>;

    #[test]
    fn apply_shared_defaults_inherits_well_known_url_from_oidc_block() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            ..Default::default()
        };

        let raw = RawConfig::default();
        let config = raw
            .apply_shared_defaults(&shared)
            .expect("should resolve with shared defaults");

        assert_eq!(
            config.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration"),
            "well_known_url should be inherited from [oidc]"
        );
        assert_eq!(
            config.client_id, "shared-app",
            "client_id should be inherited from [oidc]"
        );
        assert!(config.client_secret.is_none());
    }

    #[test]
    fn local_client_id_overrides_shared_client_id() {
        let shared = OidcSharedConfig {
            client_id: Some("shared-app".to_string()),
            ..Default::default()
        };

        let raw = RawConfig {
            client_id: Some("local-app".to_string()),
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        let config = raw.apply_shared_defaults(&shared).expect("should resolve");

        assert_eq!(config.client_id, "local-app", "local client_id must win");
    }

    #[test]
    fn missing_client_id_everywhere_returns_error() {
        let shared = OidcSharedConfig::default();
        let raw = RawConfig::default();

        let result = raw.apply_shared_defaults(&shared);
        assert!(result.is_err(), "should fail when client_id is absent");
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("client_id must be set")
        );
    }

    #[test]
    fn default_scopes_are_applied_when_not_overridden() {
        let shared = OidcSharedConfig {
            client_id: Some("app".to_string()),
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        let raw = RawConfig::default();
        let config = raw.apply_shared_defaults(&shared).expect("should resolve");

        assert_eq!(config.scopes, default_scopes());
    }

    // ---------------------------------------------------------------------------
    // resolve_config (unified entry) tests
    // ---------------------------------------------------------------------------

    #[test]
    fn resolve_config_applies_shared_defaults_and_validates() {
        let shared = OidcSharedConfig {
            client_id: Some("app".to_string()),
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        let raw = RawConfig::default();

        // resolve_config = apply_shared_defaults + validate in one call
        let config = raw
            .resolve_config(&shared)
            .expect("should resolve and validate");
        assert_eq!(config.client_id, "app");
        assert_eq!(
            config.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known"),
        );
    }

    #[test]
    fn resolve_config_propagates_validation_failure() {
        let shared = OidcSharedConfig {
            client_id: Some("app".to_string()),
            // No well_known_url and no manual endpoints → validation should fail
            ..Default::default()
        };
        let raw = RawConfig::default();

        let result = raw.resolve_config(&shared);
        assert!(
            result.is_err(),
            "should fail validation without well_known_url or manual endpoints"
        );
    }
}
