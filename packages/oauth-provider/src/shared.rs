use serde::Deserialize;
use serde_with::{NoneAsEmptyString, serde_as};

use crate::{OAuthProviderRemoteConfig, default_jwks_refresh_interval};

/// Shared OIDC alias configuration block — provider remote fallback skeleton.
///
/// When present in the application config (typically `[oidc]`), provides
/// fallback values for `OAuthProviderRemoteConfig` fields that both
/// `oidc-client` and `oauth-resource-server` need. Also holds optional
/// confidential-client defaults (`client_id`, `client_secret`) that are
/// commonly shared in single-provider deployments with introspection.
///
/// # Current scope (supported fields)
///
/// - `well_known_url`, `issuer_url`, `jwks_uri` — URL fields with true
///   presence-aware fallback (local `Some` > shared `Some` > `None`)
/// - `client_id`, `client_secret` — optional confidential-client defaults;
///   not pure provider connectivity, but commonly shared between
///   `oidc_client` (full client) and `oauth_resource_server.introspection`
///
/// # Known limitations
///
/// Duration fields (`metadata_refresh_interval`, `jwks_refresh_interval`) are
/// non-optional in `OAuthProviderRemoteConfig` and use serde defaults. The
/// current implementation uses sentinel heuristics and **cannot distinguish**
/// "local explicitly set to the default" from "local not configured". A future
/// iteration should migrate these to `Option<Duration>`.
///
/// # Shared but not provider connectivity
///
/// `client_id` and `client_secret` can be shared via `[oidc]`, but they must
/// be resolved separately from `OAuthProviderRemoteConfig`. They are exposed
/// on this struct as optional fields and resolved through dedicated helpers.
#[serde_as]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OidcSharedConfig {
    /// Shared provider connectivity settings (URL + interval fields).
    #[serde(flatten)]
    pub remote: OAuthProviderRemoteConfig,

    /// Optional confidential-client default. Not pure provider connectivity;
    /// shared when both oidc-client and resource-server introspection use the
    /// same client identity against a single provider.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_id: Option<String>,

    /// Optional confidential-client secret default. See `client_id`.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_secret: Option<String>,
}

impl OidcSharedConfig {
    /// Resolve a local `OAuthProviderRemoteConfig` against this shared
    /// fallback. For `Option<String>` URL fields, local `Some` takes
    /// priority. For duration fields, see the struct-level doc on known
    /// limitations.
    pub fn resolve_remote(&self, local: &OAuthProviderRemoteConfig) -> OAuthProviderRemoteConfig {
        OAuthProviderRemoteConfig {
            well_known_url: local
                .well_known_url
                .clone()
                .or_else(|| self.remote.well_known_url.clone()),
            issuer_url: local
                .issuer_url
                .clone()
                .or_else(|| self.remote.issuer_url.clone()),
            jwks_uri: local
                .jwks_uri
                .clone()
                .or_else(|| self.remote.jwks_uri.clone()),
            metadata_refresh_interval: if local.metadata_refresh_interval.is_zero() {
                self.remote.metadata_refresh_interval
            } else {
                local.metadata_refresh_interval
            },
            jwks_refresh_interval: if local.jwks_refresh_interval
                == default_jwks_refresh_interval()
            {
                self.remote.jwks_refresh_interval
            } else {
                local.jwks_refresh_interval
            },
        }
    }

    /// Resolve a local optional `client_id` String against the shared
    /// `client_id` default.
    ///
    /// Returns `local` if it is `Some`; otherwise falls back to the shared
    /// default. `None` means neither local nor shared has a value.
    pub fn resolve_client_id(&self, local: Option<&str>) -> Option<String> {
        local
            .map(ToOwned::to_owned)
            .or_else(|| self.client_id.clone())
    }

    /// Resolve a local optional `client_secret` against the shared default.
    pub fn resolve_client_secret(&self, local: Option<&str>) -> Option<String> {
        local
            .map(ToOwned::to_owned)
            .or_else(|| self.client_secret.clone())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::OidcSharedConfig;
    use crate::OAuthProviderRemoteConfig;

    // ---------------------------------------------------------------------------
    // Remote URL fallback tests
    // ---------------------------------------------------------------------------

    #[test]
    fn local_url_values_take_priority_over_shared() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://shared.example.com/.well-known".to_string()),
                issuer_url: Some("https://shared.example.com".to_string()),
                jwks_uri: Some("https://shared.example.com/jwks".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        let local = OAuthProviderRemoteConfig {
            well_known_url: Some("https://local.example.com/.well-known".to_string()),
            ..Default::default()
        };
        let resolved = shared.resolve_remote(&local);

        assert_eq!(
            resolved.well_known_url.as_deref(),
            Some("https://local.example.com/.well-known"),
            "local well_known_url should take priority"
        );
        assert_eq!(
            resolved.issuer_url.as_deref(),
            Some("https://shared.example.com"),
            "shared issuer_url should fill the gap"
        );
        assert_eq!(
            resolved.jwks_uri.as_deref(),
            Some("https://shared.example.com/jwks"),
            "shared jwks_uri should fill the gap"
        );
    }

    #[test]
    fn empty_shared_returns_local_remote_unchanged() {
        let shared = OidcSharedConfig::default();
        let local = OAuthProviderRemoteConfig {
            well_known_url: Some("https://local.example.com/.well-known".to_string()),
            ..Default::default()
        };
        let resolved = shared.resolve_remote(&local);

        assert_eq!(resolved.well_known_url, local.well_known_url);
        assert!(resolved.issuer_url.is_none());
    }

    #[test]
    fn local_interval_overrides_shared_interval() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                metadata_refresh_interval: Duration::from_secs(600),
                ..Default::default()
            },
            ..Default::default()
        };
        let local = OAuthProviderRemoteConfig {
            metadata_refresh_interval: Duration::from_secs(120),
            ..Default::default()
        };
        let resolved = shared.resolve_remote(&local);

        assert_eq!(
            resolved.metadata_refresh_interval,
            Duration::from_secs(120),
            "non-zero local interval should take priority"
        );
    }

    #[test]
    fn zero_local_interval_falls_back_to_shared_interval() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                metadata_refresh_interval: Duration::from_secs(600),
                ..Default::default()
            },
            ..Default::default()
        };
        let local = OAuthProviderRemoteConfig {
            metadata_refresh_interval: Duration::ZERO,
            ..Default::default()
        };
        let resolved = shared.resolve_remote(&local);

        assert_eq!(
            resolved.metadata_refresh_interval,
            Duration::from_secs(600),
            "zero local interval should fall back to shared"
        );
    }

    // ---------------------------------------------------------------------------
    // client_id / client_secret shared-defaults tests
    // ---------------------------------------------------------------------------

    #[test]
    fn local_client_id_takes_priority_over_shared() {
        let shared = OidcSharedConfig {
            client_id: Some("shared-client".to_string()),
            ..Default::default()
        };

        let resolved = shared.resolve_client_id(Some("local-client"));
        assert_eq!(resolved.as_deref(), Some("local-client"));
    }

    #[test]
    fn shared_client_id_fills_gap_when_local_is_absent() {
        let shared = OidcSharedConfig {
            client_id: Some("shared-client".to_string()),
            ..Default::default()
        };

        let resolved = shared.resolve_client_id(None);
        assert_eq!(resolved.as_deref(), Some("shared-client"));
    }

    #[test]
    fn no_client_id_anywhere_returns_none() {
        let shared = OidcSharedConfig::default();
        let resolved = shared.resolve_client_id(None);
        assert!(resolved.is_none());
    }

    #[test]
    fn local_client_secret_takes_priority_over_shared() {
        let shared = OidcSharedConfig {
            client_secret: Some("shared-secret".to_string()),
            ..Default::default()
        };

        let resolved = shared.resolve_client_secret(Some("local-secret"));
        assert_eq!(resolved.as_deref(), Some("local-secret"));
    }

    #[test]
    fn shared_client_secret_fills_gap_when_local_is_absent() {
        let shared = OidcSharedConfig {
            client_secret: Some("shared-secret".to_string()),
            ..Default::default()
        };

        let resolved = shared.resolve_client_secret(None);
        assert_eq!(resolved.as_deref(), Some("shared-secret"));
    }

    #[test]
    fn deserialization_of_shared_config_from_flat_json() {
        // Simulates what a TOML [oidc] block deserialises into when loaded via figment.
        let json = serde_json::json!({
            "well_known_url": "https://auth.example.com/.well-known/openid-configuration",
            "client_id": "shared-app",
            "client_secret": "s3cr3t"
        });
        let config: OidcSharedConfig =
            serde_json::from_value(json).expect("shared config should deserialize");

        assert_eq!(
            config.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration")
        );
        assert_eq!(config.client_id.as_deref(), Some("shared-app"));
        assert_eq!(config.client_secret.as_deref(), Some("s3cr3t"));
    }
}
