use std::time::Duration;

use openidconnect::core::{CoreClientAuthMethod, CoreJwsSigningAlgorithm};
use securitydept_utils::ser::CommaOrSpaceSeparated;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, PickFirst, serde_as};

use crate::{OAuthProviderError, OAuthProviderResult};

/// Shared provider connectivity settings used by both OIDC clients and
/// resource-server verifiers.
#[serde_as]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OAuthProviderRemoteConfig {
    /// OpenID Connect discovery document URL.
    ///
    /// When set, the runtime fetches remote metadata and periodically refreshes
    /// it when `metadata_refresh_interval > 0`.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub well_known_url: Option<String>,
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub issuer_url: Option<String>,
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub jwks_uri: Option<String>,
    /// Refresh interval for the discovery metadata cache.
    ///
    /// Set to `0` to disable periodic discovery refresh.
    #[serde(
        default = "default_metadata_refresh_interval",
        with = "humantime_serde"
    )]
    pub metadata_refresh_interval: Duration,
    /// Refresh interval for the remote JWKS cache.
    ///
    /// Set to `0` to disable time-based JWKS refresh.
    #[serde(default = "default_jwks_refresh_interval", with = "humantime_serde")]
    pub jwks_refresh_interval: Duration,
}

impl OAuthProviderRemoteConfig {
    pub fn validate(&self) -> OAuthProviderResult<()> {
        if self.well_known_url.is_none() && (self.issuer_url.is_none() || self.jwks_uri.is_none()) {
            return Err(OAuthProviderError::InvalidConfig {
                message: "When well_known_url is not set, issuer_url and jwks_uri must be set"
                    .to_string(),
            });
        }

        Ok(())
    }
}

/// OIDC-specific provider metadata overrides.
#[serde_as]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OAuthProviderOidcConfig {
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub authorization_endpoint: Option<String>,
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub token_endpoint: Option<String>,
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub userinfo_endpoint: Option<String>,
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub introspection_endpoint: Option<String>,
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub revocation_endpoint: Option<String>,
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub device_authorization_endpoint: Option<String>,
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreClientAuthMethod>, _)>>")]
    #[serde(default)]
    pub token_endpoint_auth_methods_supported: Option<Vec<CoreClientAuthMethod>>,
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreJwsSigningAlgorithm>, _)>>")]
    #[serde(default)]
    pub id_token_signing_alg_values_supported: Option<Vec<CoreJwsSigningAlgorithm>>,
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreJwsSigningAlgorithm>, _)>>")]
    #[serde(default)]
    pub userinfo_signing_alg_values_supported: Option<Vec<CoreJwsSigningAlgorithm>>,
}

/// Normalized provider runtime config.
#[serde_as]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OAuthProviderConfig {
    #[serde(flatten)]
    pub remote: OAuthProviderRemoteConfig,
    #[serde(flatten)]
    pub oidc: OAuthProviderOidcConfig,
}

impl OAuthProviderConfig {
    pub fn validate(&self) -> OAuthProviderResult<()> {
        self.remote.validate()
    }
}

pub fn default_metadata_refresh_interval() -> Duration {
    Duration::ZERO
}

pub fn default_jwks_refresh_interval() -> Duration {
    Duration::from_secs(300)
}

pub fn default_id_token_signing_alg_values_supported() -> Vec<CoreJwsSigningAlgorithm> {
    vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256]
}

#[cfg(test)]
mod tests {
    use openidconnect::core::{CoreClientAuthMethod, CoreJwsSigningAlgorithm};

    use super::{OAuthProviderConfig, OAuthProviderOidcConfig, OAuthProviderRemoteConfig};

    #[test]
    fn deserialize_empty_strings_as_none() {
        let config: OAuthProviderConfig = serde_json::from_value(serde_json::json!({
            "well_known_url": "",
            "issuer_url": "https://issuer.example.com",
            "jwks_uri": "https://issuer.example.com/jwks"
        }))
        .expect("config should deserialize");

        assert!(config.remote.well_known_url.is_none());
        assert_eq!(
            config.remote.issuer_url.as_deref(),
            Some("https://issuer.example.com")
        );
    }

    #[test]
    fn deserialize_space_or_comma_separated_algorithms() {
        let config: OAuthProviderConfig = serde_json::from_value(serde_json::json!({
            "issuer_url": "https://issuer.example.com",
            "jwks_uri": "https://issuer.example.com/jwks",
            "token_endpoint_auth_methods_supported": "client_secret_basic,private_key_jwt",
            "id_token_signing_alg_values_supported": "RS256 ES256",
            "userinfo_signing_alg_values_supported": ["RS256"]
        }))
        .expect("config should deserialize");

        assert_eq!(
            config.oidc.token_endpoint_auth_methods_supported,
            Some(vec![
                CoreClientAuthMethod::ClientSecretBasic,
                CoreClientAuthMethod::PrivateKeyJwt,
            ])
        );
        assert_eq!(
            config.oidc.id_token_signing_alg_values_supported,
            Some(vec![
                CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
                CoreJwsSigningAlgorithm::EcdsaP256Sha256,
            ])
        );
        assert_eq!(
            config.oidc.userinfo_signing_alg_values_supported,
            Some(vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256])
        );
    }

    #[test]
    fn validate_rejects_missing_manual_fields() {
        let config = OAuthProviderConfig::default();

        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_accepts_well_known_only() {
        let config = OAuthProviderConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://issuer.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            oidc: OAuthProviderOidcConfig::default(),
        };

        assert!(config.validate().is_ok());
    }
}
