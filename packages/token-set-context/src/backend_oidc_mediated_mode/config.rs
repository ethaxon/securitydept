use securitydept_oauth_provider::OidcSharedConfig;
use securitydept_oauth_resource_server::OAuthResourceServerConfig;
use securitydept_oidc_client::{OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig};
use serde::Deserialize;

use super::{
    BackendOidcMediatedModeRuntimeConfig,
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
};
use crate::{access_token_substrate::TokenPropagatorConfig, orchestration::BackendConfigError};

/// Trait for types that supply `backend-oidc-mediated` configuration
/// components.
///
/// Implementors expose the four component-config accessors and gain default
/// `resolve_*` helper methods that apply `[oidc]` shared defaults and validate
/// each component.
///
/// # Quick start
///
/// ```rust,ignore
/// // Use the built-in concrete config:
/// let resolved = config.resolve_all(&shared)?;
///
/// // Or implement on your own app config:
/// impl BackendOidcMediatedConfigSource<PC, MC> for MyAppConfig { ... }
/// let client_cfg = my_app_config.resolve_oidc_client(&shared)?;
/// ```
pub trait BackendOidcMediatedConfigSource<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    // --- Component accessors ---

    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<PC>;
    fn oauth_resource_server_config(&self) -> &OAuthResourceServerConfig;
    fn mediated_runtime_config(&self) -> &BackendOidcMediatedModeRuntimeConfig<MC>;
    fn token_propagation_config(&self) -> &TokenPropagatorConfig;

    // --- Resolve helpers (default implementations) ---

    /// Resolve OIDC client config by applying shared defaults.
    fn resolve_oidc_client(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<OidcClientConfig<PC>, BackendConfigError>
    where
        PC: Clone,
    {
        self.oidc_client_raw_config()
            .clone()
            .resolve_config(shared)
            .map_err(Into::into)
    }

    /// Resolve OAuth resource server config by applying shared defaults.
    fn resolve_oauth_resource_server(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<OAuthResourceServerConfig, BackendConfigError> {
        let mut rs = self.oauth_resource_server_config().clone();
        rs.resolve_config(shared)?;
        Ok(rs)
    }

    /// Validate mediated-mode runtime config.
    fn resolve_mediated_runtime(
        &self,
    ) -> Result<BackendOidcMediatedModeRuntimeConfig<MC>, BackendConfigError>
    where
        MC: Clone,
    {
        let cfg = self.mediated_runtime_config().clone();
        cfg.validate()
            .map_err(BackendConfigError::BackendOidcMediatedModeRuntime)?;
        Ok(cfg)
    }

    /// Validate token propagation config.
    fn resolve_token_propagation(&self) -> Result<TokenPropagatorConfig, BackendConfigError> {
        let cfg = self.token_propagation_config().clone();
        cfg.validate()
            .map_err(BackendConfigError::TokenPropagation)?;
        Ok(cfg)
    }

    /// **Recommended entry point.** Resolve all sub-configs in one step.
    ///
    /// ```text
    /// [oidc]                      ──┐
    /// [oidc_client]               ──┤
    /// [oauth_resource_server]     ──┼──▸ resolve_all() ──▸ ResolvedBackendOidcMediatedConfig
    /// [mediated_runtime]          ──┤
    /// [token_propagation]         ──┘
    /// ```
    fn resolve_all(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<ResolvedBackendOidcMediatedConfig<PC, MC>, BackendConfigError>
    where
        PC: Clone,
        MC: Clone,
    {
        Ok(ResolvedBackendOidcMediatedConfig {
            oidc_client: self.resolve_oidc_client(shared)?,
            oauth_resource_server: self.resolve_oauth_resource_server(shared)?,
            mediated_runtime: self.resolve_mediated_runtime()?,
            token_propagation: self.resolve_token_propagation()?,
        })
    }
}

/// Combined raw configuration for a `backend-oidc-mediated` deployment.
///
/// Bundles the configuration blocks that a mediated backend needs:
///
/// - `[oidc_client]` → [`OidcClientRawConfig`]
/// - `[oauth_resource_server]` → [`OAuthResourceServerConfig`]
/// - `[mediated_runtime]` → [`BackendOidcMediatedModeRuntimeConfig`] (runtime
///   config)
/// - `[token_propagation]` → [`TokenPropagatorConfig`]
///
/// Implements [`BackendOidcMediatedConfigSource`] with default resolve
/// behavior. Call
/// [`resolve_all`](BackendOidcMediatedConfigSource::resolve_all) to produce a
/// [`ResolvedBackendOidcMediatedConfig`].
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
/// [mediated_runtime]
/// sealed_refresh_token = true
/// master_key = "base64-encoded-key"
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct BackendOidcMediatedConfig<PC, MC>
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
    /// Mode-specific runtime config (sealed refresh, redirect, metadata
    /// redemption).
    #[serde(default, bound = "MC: PendingAuthStateMetadataRedemptionConfig")]
    pub mediated_runtime: BackendOidcMediatedModeRuntimeConfig<MC>,
    /// Token propagation config (cross-mode substrate-level concern).
    #[serde(default)]
    pub token_propagation: TokenPropagatorConfig,
}

impl<PC, MC> BackendOidcMediatedConfigSource<PC, MC> for BackendOidcMediatedConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<PC> {
        &self.oidc_client
    }

    fn oauth_resource_server_config(&self) -> &OAuthResourceServerConfig {
        &self.oauth_resource_server
    }

    fn mediated_runtime_config(&self) -> &BackendOidcMediatedModeRuntimeConfig<MC> {
        &self.mediated_runtime
    }

    fn token_propagation_config(&self) -> &TokenPropagatorConfig {
        &self.token_propagation
    }
}

/// Validated configuration bundle produced by
/// [`BackendOidcMediatedConfigSource::resolve_all`].
///
/// All sub-configs have been resolved against `[oidc]` shared defaults and
/// individually validated. Ready for runtime construction.
#[derive(Debug, Clone)]
pub struct ResolvedBackendOidcMediatedConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub oidc_client: OidcClientConfig<PC>,
    pub oauth_resource_server: OAuthResourceServerConfig,
    pub mediated_runtime: BackendOidcMediatedModeRuntimeConfig<MC>,
    pub token_propagation: TokenPropagatorConfig,
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};
    use securitydept_oauth_resource_server::OAuthResourceServerIntrospectionConfig;
    use securitydept_oidc_client::PendingOauthStoreConfig;
    use serde::Deserialize;

    use super::*;
    use crate::{
        backend_oidc_mediated_mode::PendingAuthStateMetadataRedemptionConfig,
        orchestration::BackendConfigError,
    };

    #[derive(Debug, Clone, Default, Deserialize)]
    struct TestPendingStoreConfig;
    impl PendingOauthStoreConfig for TestPendingStoreConfig {}

    #[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
    struct TestMetadataConfig;
    impl PendingAuthStateMetadataRedemptionConfig for TestMetadataConfig {}

    type Config = BackendOidcMediatedConfig<TestPendingStoreConfig, TestMetadataConfig>;

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

        let raw = Config {
            oidc_client: OidcClientRawConfig::default(),
            oauth_resource_server: OAuthResourceServerConfig {
                introspection: Some(OAuthResourceServerIntrospectionConfig::default()),
                ..Default::default()
            },
            mediated_runtime: BackendOidcMediatedModeRuntimeConfig::default(),
            token_propagation: TokenPropagatorConfig::default(),
        };

        let config = raw.resolve_all(&shared).expect("should resolve");

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

        let raw = Config {
            oidc_client: OidcClientRawConfig::default(),
            oauth_resource_server: OAuthResourceServerConfig::default(),
            mediated_runtime: BackendOidcMediatedModeRuntimeConfig::default(),
            token_propagation: TokenPropagatorConfig::default(),
        };

        let err = raw.resolve_all(&shared).unwrap_err();
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

        let raw = Config {
            oidc_client: OidcClientRawConfig::default(),
            oauth_resource_server: OAuthResourceServerConfig::default(),
            mediated_runtime: BackendOidcMediatedModeRuntimeConfig {
                sealed_refresh_token: true,
                master_key: None,
                ..Default::default()
            },
            token_propagation: TokenPropagatorConfig::default(),
        };

        let err = raw.resolve_all(&shared).unwrap_err();
        assert!(matches!(
            err,
            BackendConfigError::BackendOidcMediatedModeRuntime(_)
        ));
    }
}
