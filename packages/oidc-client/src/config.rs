use openidconnect::core::CoreJwsSigningAlgorithm;
use securitydept_oauth_provider::{
    OAuthProviderConfig, OAuthProviderOidcConfig, OAuthProviderRemoteConfig,
};
use securitydept_utils::ser::CommaOrSpaceSeparated;
use serde::Deserialize;
use serde_with::{PickFirst, serde_as};

use crate::{OidcError, OidcResult, PendingOauthStoreConfig};

/// Input configuration for building the OIDC client.
///
/// When `well_known_url` is set, discovery is fetched from it and optional
/// fields override. When not set, `issuer_url`, `authorization_endpoint`,
/// `token_endpoint`, and `jwks_uri` must be set. `userinfo_endpoint` is
/// recommended, and userinfo claims are fetched only when it is set.
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
