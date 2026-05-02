use securitydept_oauth_provider::OidcSharedConfig;
use securitydept_oidc_client::{OidcClientConfig, OidcClientRawConfig, PendingOauthStoreConfig};
use serde::Deserialize;

pub mod validator;

pub use validator::{
    BackendOidcModeConfigValidationError, BackendOidcModeConfigValidator,
    BackendOidcModeFixedRedirectUriValidator, NoopBackendOidcModeConfigValidator,
};

use super::{
    capabilities::{MetadataDelivery, PostAuthRedirectPolicy, RefreshMaterialProtection},
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
    runtime::BackendOidcModeRuntimeConfig,
};
use crate::orchestration::BackendConfigError;

/// Trait for types that supply unified `backend-oidc` configuration components.
pub trait BackendOidcModeConfigSource<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<PC>;
    fn refresh_material_protection(&self) -> &RefreshMaterialProtection;
    fn metadata_delivery(&self) -> &MetadataDelivery<MC>;
    fn post_auth_redirect(&self) -> &PostAuthRedirectPolicy;

    fn raw_backend_oidc_mode_config(&self) -> BackendOidcModeConfig<PC, MC>
    where
        PC: Clone,
        MC: Clone,
    {
        BackendOidcModeConfig {
            oidc_client: self.oidc_client_raw_config().clone(),
            refresh_material_protection: self.refresh_material_protection().clone(),
            metadata_delivery: self.metadata_delivery().clone(),
            post_auth_redirect: self.post_auth_redirect().clone(),
        }
    }

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

    fn resolve_all(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<ResolvedBackendOidcModeConfig<PC, MC>, BackendConfigError>
    where
        PC: Clone,
        MC: Clone,
    {
        let validator = NoopBackendOidcModeConfigValidator;
        self.resolve_all_with_validator(shared, &validator)
    }

    fn resolve_all_with_validator<V>(
        &self,
        shared: &OidcSharedConfig,
        validator: &V,
    ) -> Result<ResolvedBackendOidcModeConfig<PC, MC>, BackendConfigError>
    where
        PC: Clone,
        MC: Clone,
        V: BackendOidcModeConfigValidator,
    {
        let raw_config = self.raw_backend_oidc_mode_config();
        validator
            .validate_raw_backend_oidc_mode_config(&raw_config)
            .map_err(BackendConfigError::BackendOidcModeValidation)?;
        let oidc_client = self.resolve_oidc_client(shared)?;

        Ok(ResolvedBackendOidcModeConfig {
            oidc_client,
            runtime: self.resolve_runtime()?,
        })
    }
}

#[cfg_attr(feature = "config-schema", derive(schemars::JsonSchema))]
#[cfg_attr(
    feature = "config-schema",
    schemars(bound = "PC: schemars::JsonSchema, MC: schemars::JsonSchema")
)]
#[derive(Debug, Clone, Deserialize)]
pub struct BackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    #[serde(default, flatten, bound = "PC: PendingOauthStoreConfig")]
    pub oidc_client: OidcClientRawConfig<PC>,
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

#[derive(Debug, Clone)]
pub struct ResolvedBackendOidcModeConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub oidc_client: OidcClientConfig<PC>,
    pub runtime: BackendOidcModeRuntimeConfig<MC>,
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};
    use securitydept_oidc_client::PendingOauthStoreConfig;
    use securitydept_utils::secret::SecretString;
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
    fn resolve_config_inherits_oidc_client_shared_defaults() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            client_secret: Some(SecretString::from("shared-secret")),
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

    #[test]
    fn fixed_redirect_validator_overrides_resolved_redirect_url() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            client_id: Some("app".to_string()),
            ..Default::default()
        };

        let raw = Config::default();
        let fixed_redirect =
            BackendOidcModeFixedRedirectUriValidator::new("/auth/token-set/backend-mode/callback");
        let resolved = raw
            .resolve_all_with_validator(&shared, &fixed_redirect)
            .expect("should resolve with fixed redirect validator");
        let mut resolved = resolved;
        resolved.oidc_client.redirect_url = fixed_redirect.redirect_url().to_string();

        assert_eq!(
            resolved.oidc_client.redirect_url,
            "/auth/token-set/backend-mode/callback"
        );
    }

    #[test]
    fn fixed_redirect_validator_rejects_user_redirect_override() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some("https://auth.example.com/.well-known".to_string()),
                ..Default::default()
            },
            client_id: Some("app".to_string()),
            ..Default::default()
        };

        let raw = Config {
            oidc_client: OidcClientRawConfig {
                redirect_url: Some("/custom-callback".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        let fixed_redirect =
            BackendOidcModeFixedRedirectUriValidator::new("/auth/token-set/backend-mode/callback");
        let err = raw
            .resolve_all_with_validator(&shared, &fixed_redirect)
            .unwrap_err();

        assert!(matches!(
            err,
            BackendConfigError::BackendOidcModeValidation(ref error)
                if error.field_path == "redirect_url"
                    && error.code == "fixed_redirect_uri_conflict"
        ));
    }
}
