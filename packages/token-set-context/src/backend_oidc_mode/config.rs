use securitydept_oauth_provider::OidcSharedConfig;
use securitydept_oauth_resource_server::OAuthResourceServerConfig;
use securitydept_oidc_client::{OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig};
use serde::Deserialize;

use super::{
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
    runtime::BackendOidcModeRuntimeConfig,
};
use crate::{access_token_substrate::TokenPropagatorConfig, orchestration::BackendConfigError};

/// Trait for types that supply unified `backend-oidc` configuration components.
///
/// Implementors expose component-config accessors and gain default `resolve_*`
/// helper methods that apply `[oidc]` shared defaults and validate each
/// component.
pub trait BackendOidcModeConfigSource<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    // --- Component accessors ---

    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<PC>;
    fn oauth_resource_server_config(&self) -> &OAuthResourceServerConfig;
    fn runtime_config(&self) -> &BackendOidcModeRuntimeConfig<MC>;
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

    /// Validate backend-oidc runtime config.
    fn resolve_runtime(&self) -> Result<BackendOidcModeRuntimeConfig<MC>, BackendConfigError>
    where
        MC: Clone,
    {
        let cfg = self.runtime_config().clone();
        cfg.validate()
            .map_err(BackendConfigError::BackendOidcModeRuntime)?;
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
    fn resolve_all(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<ResolvedBackendOidcModeConfig<PC, MC>, BackendConfigError>
    where
        PC: Clone,
        MC: Clone,
    {
        Ok(ResolvedBackendOidcModeConfig {
            oidc_client: self.resolve_oidc_client(shared)?,
            oauth_resource_server: self.resolve_oauth_resource_server(shared)?,
            oidc_runtime: self.resolve_runtime()?,
            token_propagation: self.resolve_token_propagation()?,
        })
    }
}

/// Combined raw configuration for a unified `backend-oidc` deployment.
#[derive(Debug, Clone, Deserialize)]
pub struct BackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    #[serde(default, bound = "PC: PendingOauthStoreConfig")]
    pub oidc_client: OidcClientRawConfig<PC>,
    #[serde(default)]
    pub oauth_resource_server: OAuthResourceServerConfig,
    #[serde(
        default,
        rename = "oidc_extension",
        bound = "MC: PendingAuthStateMetadataRedemptionConfig"
    )]
    pub oidc_runtime: BackendOidcModeRuntimeConfig<MC>,
    #[serde(default)]
    pub token_propagation: TokenPropagatorConfig,
}

impl<PC, MC> BackendOidcModeConfigSource<PC, MC> for BackendOidcModeConfig<PC, MC>
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

    fn runtime_config(&self) -> &BackendOidcModeRuntimeConfig<MC> {
        &self.oidc_runtime
    }

    fn token_propagation_config(&self) -> &TokenPropagatorConfig {
        &self.token_propagation
    }
}

/// Validated configuration bundle for unified `backend-oidc`.
#[derive(Debug, Clone)]
pub struct ResolvedBackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub oidc_client: OidcClientConfig<PC>,
    pub oauth_resource_server: OAuthResourceServerConfig,
    pub oidc_runtime: BackendOidcModeRuntimeConfig<MC>,
    pub token_propagation: TokenPropagatorConfig,
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

    #[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
    struct TestMetadataConfig;
    impl PendingAuthStateMetadataRedemptionConfig for TestMetadataConfig {}

    type Config = BackendOidcModeConfig<TestPendingStoreConfig, TestMetadataConfig>;

    #[test]
    fn resolve_config_inherits_shared_defaults() {
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
            oidc_runtime: BackendOidcModeRuntimeConfig::default(),
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
    fn resolve_config_fails_without_client_id() {
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
            oidc_runtime: BackendOidcModeRuntimeConfig::default(),
            token_propagation: TokenPropagatorConfig::default(),
        };

        let err = raw.resolve_all(&shared).unwrap_err();
        assert!(matches!(err, BackendConfigError::OidcClient(_)));
    }

    #[test]
    fn resolve_config_validates_runtime() {
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
            oidc_runtime: BackendOidcModeRuntimeConfig {
                // `Resolved` with dynamic enabled but no targets triggers
                // the remaining runtime validation path.
                post_auth_redirect: crate::backend_oidc_mode::PostAuthRedirectPolicy::Resolved {
                    config: crate::backend_oidc_mode::BackendOidcModeRedirectUriConfig::builder()
                        .dynamic_redirect_target_enabled(true)
                        .build(),
                },
                ..Default::default()
            },
            token_propagation: TokenPropagatorConfig::default(),
        };

        let err = raw.resolve_all(&shared).unwrap_err();
        assert!(matches!(err, BackendConfigError::BackendOidcModeRuntime(_)));
    }
}
