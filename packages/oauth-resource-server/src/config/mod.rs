pub mod introspection;
#[cfg(feature = "jwe")]
pub mod jwe;

use std::time::Duration;

pub use introspection::OAuthResourceServerIntrospectionConfig;
#[cfg(feature = "jwe")]
pub use jwe::OAuthResourceServerJweConfig;
use securitydept_oauth_provider::{
    OAuthProviderConfig, OAuthProviderOidcConfig, OAuthProviderRemoteConfig, OidcSharedConfig,
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
    /// Allowed clock skew when validating `exp` and `nbf`.
    #[serde(default = "default_clock_skew", with = "humantime_serde")]
    pub clock_skew: Duration,
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
    /// watch_interval = "30s"
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
                message: "introspection.introspection_url must be set when introspection is \
                          enabled without well_known_url discovery"
                    .to_string(),
            });
        }

        Ok(())
    }

    /// Apply shared defaults from an `[oidc]` block in-place.
    ///
    /// Resolution order for supported fields:
    /// - `well_known_url`, `issuer_url`, `jwks_uri` — local > shared > None
    /// - `introspection.client_id`, `introspection.client_secret` — local >
    ///   shared > None (only when `introspection` is already `Some`)
    /// - `required_scopes` — local non-empty wins; else inherited from shared
    ///
    /// Duration fields are resolved with sentinel heuristics; see
    /// [`OidcSharedConfig`] for the known limitation.
    pub fn apply_shared_defaults(&mut self, shared: &OidcSharedConfig) {
        self.remote = shared.resolve_remote(&self.remote);

        // Inherit required_scopes from [oidc] when local list is empty.
        if self.required_scopes.is_empty() {
            self.required_scopes = shared.required_scopes.clone();
        }

        // Apply shared credential defaults into the introspection block when
        // present so that a single confidential client identity can serve both
        // oidc-client and introspection without repeating the secret.
        if let Some(introspection) = self.introspection.as_mut() {
            if introspection.client_id.is_none() {
                introspection.client_id = shared.resolve_client_id(None);
            }
            if introspection.client_secret.is_none() {
                introspection.client_secret = shared.resolve_client_secret(None);
            }
        }
    }

    /// **Recommended entry point.** Apply shared defaults and validate in one
    /// step.
    ///
    /// Equivalent to `self.apply_shared_defaults(shared); self.validate()`
    /// but eliminates manual glue.
    ///
    /// ```text
    /// [oidc]                      ──┐
    ///                               ├──▸ resolve_config() ──▸ validated &mut self
    /// [oauth_resource_server]     ──┘
    /// ```
    pub fn resolve_config(&mut self, shared: &OidcSharedConfig) -> OAuthResourceServerResult<()> {
        self.apply_shared_defaults(shared);
        self.validate()
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
            clock_skew: default_clock_skew(),
            introspection: None,
            #[cfg(feature = "jwe")]
            jwe: None,
        }
    }
}

fn default_clock_skew() -> Duration {
    Duration::from_secs(60)
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};

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

    // ---------------------------------------------------------------------------
    // Shared-defaults resolution tests
    // ---------------------------------------------------------------------------

    #[test]
    fn apply_shared_defaults_inherits_well_known_url_from_oidc_block() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig::default();
        config.apply_shared_defaults(&shared);

        assert_eq!(
            config.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration"),
            "well_known_url should be inherited from [oidc]"
        );
    }

    #[test]
    fn local_well_known_url_takes_priority_over_shared() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://shared.example.com/.well-known".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://local.example.com/.well-known".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        config.apply_shared_defaults(&shared);

        assert_eq!(
            config.remote.well_known_url.as_deref(),
            Some("https://local.example.com/.well-known"),
            "local well_known_url should take priority over shared"
        );
    }

    #[test]
    fn apply_shared_defaults_fills_introspection_client_id_from_oidc_block() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            client_secret: Some("shared-secret".to_string()),
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig {
            introspection: Some(OAuthResourceServerIntrospectionConfig::default()),
            ..Default::default()
        };
        config.apply_shared_defaults(&shared);

        let introspection = config.introspection.as_ref().unwrap();
        assert_eq!(
            introspection.client_id.as_deref(),
            Some("shared-app"),
            "introspection.client_id should be inherited from [oidc]"
        );
        assert_eq!(
            introspection.client_secret.as_deref(),
            Some("shared-secret"),
            "introspection.client_secret should be inherited from [oidc]"
        );
        // validate() should now pass
        assert!(
            config.validate().is_ok(),
            "config should be valid after shared defaults applied"
        );
    }

    #[test]
    fn local_introspection_client_id_not_overwritten_by_shared() {
        let shared = OidcSharedConfig {
            client_id: Some("shared-app".to_string()),
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            introspection: Some(OAuthResourceServerIntrospectionConfig {
                client_id: Some("local-rs".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };
        config.apply_shared_defaults(&shared);

        assert_eq!(
            config.introspection.unwrap().client_id.as_deref(),
            Some("local-rs"),
            "local introspection.client_id must take priority over shared"
        );
    }

    #[test]
    fn shared_defaults_not_applied_when_no_introspection_block() {
        let shared = OidcSharedConfig {
            client_id: Some("shared-app".to_string()),
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig::default();
        config.apply_shared_defaults(&shared);

        // No introspection block — should not create one from shared defaults
        assert!(
            config.introspection.is_none(),
            "should not create introspection block from shared defaults alone"
        );
    }

    #[test]
    fn shared_required_scopes_inherited_when_local_is_empty() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            required_scopes: vec!["openid".to_string(), "read:data".to_string()],
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig::default();
        config.apply_shared_defaults(&shared);

        assert_eq!(
            config.required_scopes,
            vec!["openid".to_string(), "read:data".to_string()],
            "required_scopes should be inherited from [oidc]"
        );
    }

    #[test]
    fn local_required_scopes_win_over_shared() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            required_scopes: vec!["openid".to_string()],
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig {
            required_scopes: vec!["entries.read".to_string(), "entries.write".to_string()],
            ..Default::default()
        };
        config.apply_shared_defaults(&shared);

        assert_eq!(
            config.required_scopes,
            vec!["entries.read".to_string(), "entries.write".to_string()],
            "local required_scopes must take priority over shared"
        );
    }

    // ---------------------------------------------------------------------------
    // resolve_config (unified entry) tests
    // ---------------------------------------------------------------------------

    #[test]
    fn resolve_config_applies_defaults_and_validates_in_one_step() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            client_secret: Some("shared-secret".to_string()),
            ..Default::default()
        };

        let mut config = OAuthResourceServerConfig {
            introspection: Some(OAuthResourceServerIntrospectionConfig::default()),
            ..Default::default()
        };

        config
            .resolve_config(&shared)
            .expect("should resolve and validate");

        assert_eq!(
            config.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration"),
        );
        assert_eq!(
            config.introspection.as_ref().unwrap().client_id.as_deref(),
            Some("shared-app"),
        );
    }

    #[test]
    fn resolve_config_propagates_validation_error() {
        let shared = OidcSharedConfig::default(); // no well_known_url
        let mut config = OAuthResourceServerConfig::default(); // no manual fields

        let result = config.resolve_config(&shared);
        assert!(result.is_err(), "should fail validation");
    }
}
