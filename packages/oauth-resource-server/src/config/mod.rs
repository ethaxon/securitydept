pub mod introspection;
#[cfg(feature = "jwe")]
pub mod jwe;

pub use introspection::OAuthResourceServerIntrospectionConfig;
#[cfg(feature = "jwe")]
pub use jwe::OAuthResourceServerJweConfig;
use securitydept_oauth_provider::{
    OAuthProviderConfig, OAuthProviderOidcConfig, OAuthProviderRemoteConfig,
};
use securitydept_utils::ser::CommaOrSpaceSeparated;
use serde::Deserialize;
use serde_with::{PickFirst, serde_as};

use crate::{OAuthResourceServerError, OAuthResourceServerResult};

#[serde_as]
#[derive(Debug, Clone, Deserialize)]
pub struct OAuthResourceServerConfig {
    /// Shared remote-provider connectivity settings.
    #[serde(flatten)]
    pub remote: OAuthProviderRemoteConfig,
    /// Accepted `aud` values. Empty means audience validation is disabled.
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default)]
    pub audiences: Vec<String>,
    /// Required scopes. Empty means no scope requirement is enforced.
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default)]
    pub required_scopes: Vec<String>,
    /// Allowed clock skew, in seconds, when validating `exp` and `nbf`.
    #[serde(default = "default_clock_skew_seconds")]
    pub clock_skew_seconds: u64,
    /// Optional opaque-token introspection configuration.
    ///
    /// Example TOML:
    /// ```toml
    /// [oauth_resource_server]
    /// well_known_url = "https://issuer.example.com/.well-known/openid-configuration"
    /// audiences = ["api://securitydept"]
    /// required_scopes = ["entries.read", "entries.write"]
    ///
    /// [oauth_resource_server.introspection]
    /// client_id = "resource-server"
    /// client_secret = "secret"
    /// token_type_hint = "access_token"
    /// # optional override:
    /// # introspection_url = "https://issuer.example.com/oauth2/introspect"
    /// ```
    #[serde(default)]
    pub introspection: Option<OAuthResourceServerIntrospectionConfig>,
    #[cfg(feature = "jwe")]
    /// Optional JWE resource-server configuration.
    ///
    /// Example TOML:
    /// ```toml
    /// [oauth_resource_server.jwe]
    /// jwe_jwks_path = "config/jwe-private.jwks"
    /// # or jwe_jwk_path = "config/jwe-private.jwk"
    /// # or jwe_pem_path = "config/jwe-private.pem"
    /// watch_interval_seconds = 30
    /// jwe_pem_key_id = "enc-key-1"
    /// jwe_pem_algorithm = "RSA-OAEP-256"
    /// jwe_pem_key_use = "enc"
    /// ```
    #[serde(default)]
    pub jwe: Option<OAuthResourceServerJweConfig>,
}

impl OAuthResourceServerConfig {
    pub fn validate(&self) -> OAuthResourceServerResult<()> {
        self.remote.validate()?;

        if let Some(introspection) = self.introspection.as_ref()
            && introspection
                .client_id
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err(OAuthResourceServerError::InvalidConfig {
                message: "introspection.client_id must be set when introspection is enabled"
                    .to_string(),
            });
        }

        if let Some(introspection) = self.introspection.as_ref()
            && self.remote.well_known_url.is_none()
            && introspection
                .introspection_url
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err(OAuthResourceServerError::InvalidConfig {
                message: "introspection.introspection_url must be set when introspection is enabled without well_known_url discovery".to_string(),
            });
        }

        Ok(())
    }

    pub fn provider_config(&self) -> OAuthProviderConfig {
        OAuthProviderConfig {
            remote: self.remote.clone(),
            oidc: OAuthProviderOidcConfig {
                introspection_endpoint: self
                    .introspection
                    .as_ref()
                    .and_then(|value| value.introspection_url.clone()),
                ..Default::default()
            },
        }
    }
}

impl Default for OAuthResourceServerConfig {
    fn default() -> Self {
        Self {
            remote: OAuthProviderRemoteConfig::default(),
            audiences: Vec::new(),
            required_scopes: Vec::new(),
            clock_skew_seconds: default_clock_skew_seconds(),
            introspection: None,
            #[cfg(feature = "jwe")]
            jwe: None,
        }
    }
}

fn default_clock_skew_seconds() -> u64 {
    60
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::OAuthProviderRemoteConfig;

    #[cfg(feature = "jwe")]
    use super::OAuthResourceServerJweConfig;
    use super::{OAuthResourceServerConfig, OAuthResourceServerIntrospectionConfig};

    #[test]
    fn validate_accepts_well_known_only() {
        let config = OAuthResourceServerConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://issuer.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(config.validate().is_ok());
    }

    #[test]
    fn validate_rejects_missing_manual_fields() {
        let config = OAuthResourceServerConfig::default();

        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_introspection_without_client_id() {
        let config = OAuthResourceServerConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://issuer.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            introspection: Some(OAuthResourceServerIntrospectionConfig::default()),
            ..Default::default()
        };

        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_rejects_manual_introspection_without_endpoint() {
        let config = OAuthResourceServerConfig {
            remote: OAuthProviderRemoteConfig {
                issuer_url: Some("https://issuer.example.com".to_string()),
                jwks_uri: Some("https://issuer.example.com/jwks".to_string()),
                ..Default::default()
            },
            introspection: Some(OAuthResourceServerIntrospectionConfig {
                client_id: Some("resource-server".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert!(config.validate().is_err());
    }

    #[test]
    fn validate_accepts_discovered_introspection_without_endpoint_override() {
        let config = OAuthResourceServerConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://issuer.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            introspection: Some(OAuthResourceServerIntrospectionConfig {
                client_id: Some("resource-server".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert!(config.validate().is_ok());
    }

    #[cfg(feature = "jwe")]
    #[test]
    fn validate_accepts_manual_jwe_jwks_path() {
        let config = OAuthResourceServerConfig {
            remote: OAuthProviderRemoteConfig {
                issuer_url: Some("https://issuer.example.com".to_string()),
                jwks_uri: Some("https://issuer.example.com/jwks".to_string()),
                ..Default::default()
            },
            jwe: Some(OAuthResourceServerJweConfig {
                jwe_jwks_path: Some("data/jwe-private.jwks".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };

        assert!(config.validate().is_ok());
    }
}
