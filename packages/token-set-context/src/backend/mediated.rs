use securitydept_oauth_provider::OidcSharedConfig;
use securitydept_oauth_resource_server::OAuthResourceServerConfig;
use securitydept_oidc_client::{
    OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig,
};
use serde::Deserialize;

use super::BackendConfigError;
use crate::{
    MediatedContextConfig,
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
};

/// Combined raw configuration for a `backend-oidc-mediated` deployment.
///
/// Bundles the three configuration blocks that a mediated backend needs:
///
/// - `[oidc_client]` → [`OidcClientRawConfig`]
/// - `[oauth_resource_server]` → [`OAuthResourceServerConfig`]
/// - `[mediated_context]` → [`MediatedContextConfig`]
///
/// Call [`resolve_config`](Self::resolve_config) to apply `[oidc]` shared
/// defaults, validate, and produce a [`BackendOidcMediatedConfig`] in one
/// step.
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
///
/// [oauth_resource_server]
/// audiences = ["api://my-app"]
///
/// [oauth_resource_server.introspection]
/// # client_id and client_secret inherited from [oidc]
///
/// [mediated_context]
/// sealed_refresh_token = true
/// master_key = "base64-encoded-key"
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct BackendOidcMediatedRawConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    /// Raw OIDC client config (allows optional client_id for shared-defaults).
    #[serde(default, bound = "PC: PendingOauthStoreConfig")]
    pub oidc_client: OidcClientRawConfig<PC>,
    /// Resource server config (introspection credentials can be shared).
    #[serde(default)]
    pub oauth_resource_server: OAuthResourceServerConfig,
    /// Token-set context config (sealed refresh, propagation, etc.).
    #[serde(
        default,
        bound = "MC: PendingAuthStateMetadataRedemptionConfig"
    )]
    pub mediated_context: MediatedContextConfig<MC>,
}

/// Validated configuration bundle produced by
/// [`BackendOidcMediatedRawConfig::resolve_config`].
///
/// All three sub-configs have been resolved against `[oidc]` shared defaults
/// and individually validated. Ready for runtime construction.
#[derive(Debug, Clone)]
pub struct BackendOidcMediatedConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub oidc_client: OidcClientConfig<PC>,
    pub oauth_resource_server: OAuthResourceServerConfig,
    pub mediated_context: MediatedContextConfig<MC>,
}

impl<PC, MC> BackendOidcMediatedRawConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    /// **Recommended entry point for `backend-oidc-mediated` deployments.**
    ///
    /// Resolves all three sub-configs against the `[oidc]` shared defaults
    /// block and validates each one. Returns a ready-to-use
    /// [`BackendOidcMediatedConfig`].
    ///
    /// ```text
    /// [oidc]                      ──┐
    /// [oidc_client]               ──┤
    /// [oauth_resource_server]     ──┼──▸ resolve_config() ──▸ BackendOidcMediatedConfig
    /// [mediated_context]         ──┘
    /// ```
    pub fn resolve_config(
        self,
        shared: &OidcSharedConfig,
    ) -> Result<BackendOidcMediatedConfig<PC, MC>, BackendConfigError> {
        // 1. Resolve oidc-client (apply shared defaults + validate)
        let oidc_client = self.oidc_client.resolve_config(shared)?;

        // 2. Resolve resource-server (apply shared defaults + validate)
        let mut oauth_resource_server = self.oauth_resource_server;
        oauth_resource_server.resolve_config(shared)?;

        // 3. Validate token-set-context (no shared-defaults fields currently,
        //    but validation is part of the unified pipeline)
        self.mediated_context
            .validate()
            .map_err(BackendConfigError::MediatedContext)?;

        Ok(BackendOidcMediatedConfig {
            oidc_client,
            oauth_resource_server,
            mediated_context: self.mediated_context,
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
    use crate::backend::BackendConfigError;
    use crate::metadata_redemption::PendingAuthStateMetadataRedemptionConfig;

    #[derive(Debug, Clone, Default, Deserialize)]
    struct TestPendingStoreConfig;
    impl PendingOauthStoreConfig for TestPendingStoreConfig {}

    #[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
    struct TestMetadataConfig;
    impl PendingAuthStateMetadataRedemptionConfig for TestMetadataConfig {}

    type RawConfig = BackendOidcMediatedRawConfig<TestPendingStoreConfig, TestMetadataConfig>;

    #[test]
    fn mediated_resolve_config_inherits_shared_defaults() {
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
            mediated_context: MediatedContextConfig::default(),
        };

        let config = raw.resolve_config(&shared).expect("should resolve");

        assert_eq!(config.oidc_client.client_id, "shared-app");
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
    fn mediated_resolve_config_fails_without_client_id() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };

        let raw = RawConfig {
            oidc_client: OidcClientRawConfig::default(),
            oauth_resource_server: OAuthResourceServerConfig::default(),
            mediated_context: MediatedContextConfig::default(),
        };

        let err = raw.resolve_config(&shared).unwrap_err();
        assert!(matches!(err, BackendConfigError::OidcClient(_)));
    }

    #[test]
    fn mediated_resolve_config_validates_mediated_context() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            client_id: Some("app".to_string()),
            ..Default::default()
        };

        let raw = RawConfig {
            oidc_client: OidcClientRawConfig::default(),
            oauth_resource_server: OAuthResourceServerConfig::default(),
            mediated_context: MediatedContextConfig {
                sealed_refresh_token: true,
                master_key: None,
                ..Default::default()
            },
        };

        let err = raw.resolve_config(&shared).unwrap_err();
        assert!(matches!(err, BackendConfigError::MediatedContext(_)));
    }
}
