use securitydept_oauth_provider::OidcSharedConfig;
use securitydept_oauth_resource_server::OAuthResourceServerConfig;
use securitydept_oidc_client::{OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig};
use serde::Deserialize;

use crate::orchestration::BackendConfigError;

/// Raw configuration for a `backend-oidc-pure` deployment.
///
/// Bundles the two configuration blocks that a pure OIDC backend needs:
///
/// - `[oidc_client]` → [`OidcClientRawConfig`]
/// - `[oauth_resource_server]` → [`OAuthResourceServerConfig`]
///
/// Unlike `backend-oidc-mediated`, this mode has no sealed refresh material,
/// metadata redemption, or token propagation. It is a standard OIDC client
/// paired with a resource server for token verification.
///
/// Call [`resolve_config`](Self::resolve_config) to apply `[oidc]` shared
/// defaults, validate, and produce a [`BackendOidcPureConfig`].
///
/// # Example (conceptual TOML)
///
/// ```toml
/// [oidc]
/// well_known_url = "https://auth.example.com/.well-known/openid-configuration"
/// client_id = "my-app"
/// client_secret = "secret"
///
/// [oidc_client]
/// scopes = "openid profile email"
/// redirect_url = "/auth/callback"
///
/// [oauth_resource_server]
/// audiences = ["api://my-app"]
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct BackendOidcPureRawConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    /// Raw OIDC client config (allows optional client_id for shared-defaults).
    #[serde(default, bound = "PC: PendingOauthStoreConfig")]
    pub oidc_client: OidcClientRawConfig<PC>,
    /// Resource server config (introspection credentials can be shared).
    #[serde(default)]
    pub oauth_resource_server: OAuthResourceServerConfig,
}

/// Validated configuration bundle for `backend-oidc-pure`.
///
/// Both sub-configs have been resolved against `[oidc]` shared defaults
/// and individually validated. Ready for runtime construction.
#[derive(Debug, Clone)]
pub struct BackendOidcPureConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    pub oidc_client: OidcClientConfig<PC>,
    pub oauth_resource_server: OAuthResourceServerConfig,
}

impl<PC> Default for BackendOidcPureRawConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    fn default() -> Self {
        Self {
            oidc_client: OidcClientRawConfig::default(),
            oauth_resource_server: OAuthResourceServerConfig::default(),
        }
    }
}

impl<PC> BackendOidcPureRawConfig<PC>
where
    PC: PendingOauthStoreConfig,
{
    /// **Recommended entry point for `backend-oidc-pure` deployments.**
    ///
    /// Resolves both sub-configs against the `[oidc]` shared defaults block
    /// and validates each one. Returns a ready-to-use
    /// [`BackendOidcPureConfig`].
    ///
    /// ```text
    /// [oidc]                      ──┐
    /// [oidc_client]               ──┼──▸ resolve_config() ──▸ BackendOidcPureConfig
    /// [oauth_resource_server]     ──┘
    /// ```
    pub fn resolve_config(
        self,
        shared: &OidcSharedConfig,
    ) -> Result<BackendOidcPureConfig<PC>, BackendConfigError> {
        let oidc_client = self.oidc_client.resolve_config(shared)?;

        let mut oauth_resource_server = self.oauth_resource_server;
        oauth_resource_server.resolve_config(shared)?;

        Ok(BackendOidcPureConfig {
            oidc_client,
            oauth_resource_server,
        })
    }
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};
    use securitydept_oauth_resource_server::OAuthResourceServerIntrospectionConfig;
    use securitydept_oidc_client::PendingOauthStoreConfig;
    use serde::Deserialize;

    use super::*;
    use crate::orchestration::BackendConfigError;

    #[derive(Debug, Clone, Default, Deserialize)]
    struct TestPendingStoreConfig;
    impl PendingOauthStoreConfig for TestPendingStoreConfig {}

    type RawConfig = BackendOidcPureRawConfig<TestPendingStoreConfig>;

    #[test]
    fn pure_resolve_config_inherits_shared_defaults() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            client_secret: Some("shared-secret".to_string()),
        };

        let raw = RawConfig {
            oidc_client: OidcClientRawConfig::default(),
            oauth_resource_server: OAuthResourceServerConfig {
                introspection: Some(OAuthResourceServerIntrospectionConfig::default()),
                ..Default::default()
            },
        };

        let config = raw.resolve_config(&shared).expect("should resolve");

        assert_eq!(config.oidc_client.client_id, "shared-app");
        assert_eq!(
            config.oidc_client.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration"),
        );
        assert_eq!(
            config
                .oauth_resource_server
                .introspection
                .as_ref()
                .unwrap()
                .client_id
                .as_deref(),
            Some("shared-app"),
        );
    }

    #[test]
    fn pure_resolve_config_fails_without_client_id() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };

        let raw = RawConfig {
            oidc_client: OidcClientRawConfig::default(),
            ..Default::default()
        };

        let err = raw.resolve_config(&shared).unwrap_err();
        assert!(matches!(err, BackendConfigError::OidcClient(_)));
    }

    #[test]
    fn pure_resolve_config_fails_on_resource_server_validation() {
        let shared = OidcSharedConfig::default(); // no well_known_url

        let raw = RawConfig {
            oidc_client: OidcClientRawConfig {
                client_id: Some("app".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };

        // oidc-client will fail validation (no well_known_url and no manual endpoints)
        let err = raw.resolve_config(&shared).unwrap_err();
        assert!(matches!(err, BackendConfigError::OidcClient(_)));
    }
}
