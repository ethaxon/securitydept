use securitydept_oauth_provider::OidcSharedConfig;
use securitydept_oidc_client::{OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig};
use serde::Deserialize;

use super::{
    capabilities::{MetadataDelivery, PostAuthRedirectPolicy, RefreshMaterialProtection},
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
    runtime::BackendOidcModeRuntimeConfig,
};
use crate::orchestration::BackendConfigError;

// ---------------------------------------------------------------------------
// Config source trait
// ---------------------------------------------------------------------------

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
    fn refresh_material_protection(&self) -> &RefreshMaterialProtection;
    fn metadata_delivery(&self) -> &MetadataDelivery<MC>;
    fn post_auth_redirect(&self) -> &PostAuthRedirectPolicy;

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

    /// Build and validate backend-oidc runtime config.
    fn resolve_runtime(&self) -> Result<BackendOidcModeRuntimeConfig<MC>, BackendConfigError>
    where
        MC: Clone,
    {
        let cfg = BackendOidcModeRuntimeConfig {
            refresh_material_protection: self.refresh_material_protection().clone(),
            metadata_delivery: self.metadata_delivery().clone(),
            post_auth_redirect: self.post_auth_redirect().clone(),
        };
        cfg.validate()
            .map_err(BackendConfigError::BackendOidcModeRuntime)?;
        Ok(cfg)
    }

    /// **Recommended entry point.** Resolve all OIDC mode sub-configs in one
    /// step.
    ///
    /// Note: resource-server config resolution (which also needs the OIDC
    /// shared defaults) is handled separately via
    /// [`AccessTokenSubstrateConfig::resolve_resource_server`].
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
            runtime: self.resolve_runtime()?,
        })
    }
}

// ---------------------------------------------------------------------------
// Raw config (TOML / env deserialisable)
// ---------------------------------------------------------------------------

/// Combined raw configuration for a unified `backend-oidc` deployment.
///
/// All capability axis fields are flattened at the top level so TOML adopters
/// can write a single `[backend_oidc]` section without nested sub-tables.
///
/// ```text
/// [backend_oidc]
/// # oidc client fields (from OidcClientRawConfig)
/// well_known_url = "..."
/// client_id      = "..."
///
/// # runtime capability axes
/// refresh_material_protection = { type = "sealed", master_key = "..." }
/// metadata_delivery           = { type = "none" }
/// post_auth_redirect          = { type = "caller_validated" }
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct BackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    // --- OIDC client ---
    #[serde(default, flatten, bound = "PC: PendingOauthStoreConfig")]
    pub oidc_client: OidcClientRawConfig<PC>,

    // --- Runtime capability axes (flattened from BackendOidcModeRuntimeConfig) ---
    #[serde(default, bound(deserialize = ""))]
    pub refresh_material_protection: RefreshMaterialProtection,

    #[serde(
        default,
        bound(deserialize = "MC: PendingAuthStateMetadataRedemptionConfig")
    )]
    pub metadata_delivery: MetadataDelivery<MC>,

    #[serde(default)]
    pub post_auth_redirect: PostAuthRedirectPolicy,
}

impl<PC, MC> Default for BackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn default() -> Self {
        Self {
            oidc_client: OidcClientRawConfig::default(),
            refresh_material_protection: RefreshMaterialProtection::default(),
            metadata_delivery: MetadataDelivery::default(),
            post_auth_redirect: PostAuthRedirectPolicy::default(),
        }
    }
}

impl<PC, MC> BackendOidcModeConfigSource<PC, MC> for BackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<PC> {
        &self.oidc_client
    }

    fn refresh_material_protection(&self) -> &RefreshMaterialProtection {
        &self.refresh_material_protection
    }

    fn metadata_delivery(&self) -> &MetadataDelivery<MC> {
        &self.metadata_delivery
    }

    fn post_auth_redirect(&self) -> &PostAuthRedirectPolicy {
        &self.post_auth_redirect
    }
}

// ---------------------------------------------------------------------------
// Resolved (validated) config
// ---------------------------------------------------------------------------

/// Validated configuration bundle for unified `backend-oidc`.
///
/// Produced by [`BackendOidcModeConfigSource::resolve_all`].
#[derive(Debug, Clone)]
pub struct ResolvedBackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub oidc_client: OidcClientConfig<PC>,
    pub runtime: BackendOidcModeRuntimeConfig<MC>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};
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

    /// Verify that OIDC client config inherits shared provider defaults.
    /// Note: resource-server shared-defaults resolution is tested separately in
    /// `access_token_substrate::config` tests.
    #[test]
    fn resolve_config_inherits_oidc_client_shared_defaults() {
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

        let raw = Config::default();

        let config = raw.resolve_all(&shared).expect("should resolve");
        assert_eq!(config.oidc_client.client_id, "shared-app");
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

        let raw = Config::default();

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
            post_auth_redirect: crate::backend_oidc_mode::PostAuthRedirectPolicy::Resolved {
                config: crate::backend_oidc_mode::BackendOidcModeRedirectUriConfig::builder()
                    .dynamic_redirect_target_enabled(true)
                    .build(),
            },
            ..Default::default()
        };

        let err = raw.resolve_all(&shared).unwrap_err();
        assert!(matches!(err, BackendConfigError::BackendOidcModeRuntime(_)));
    }
}
