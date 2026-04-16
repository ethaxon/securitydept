use std::time::Duration;

use openidconnect::core::{CoreClientAuthMethod, CoreJwsSigningAlgorithm};
use securitydept_oauth_provider::{OAuthProviderOidcConfig, OAuthProviderRemoteConfig};
use securitydept_oidc_client::{
    OidcClientRawConfig, PendingOauthStoreConfig,
    config::{default_device_poll_interval, default_scopes},
};
use securitydept_utils::ser::CommaOrSpaceSeparated;
use serde::Deserialize;
use serde_with::{NoneAsEmptyString, PickFirst, serde_as};

use crate::{
    backend_oidc_mode::{
        BackendOidcModeConfig, MetadataDelivery, PendingAuthStateMetadataRedemptionConfig,
        PostAuthRedirectPolicy, RefreshMaterialProtection,
    },
    frontend_oidc_mode::{
        FrontendOidcModeCapabilities, FrontendOidcModeConfig, NoPendingStoreConfig,
        UnsafeFrontendClientSecret,
    },
};

#[serde_as]
#[derive(Debug, Clone, Deserialize)]
pub struct TokenSetOidcSharedIntersectionConfig {
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_id: Option<String>,

    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_secret: Option<String>,

    #[serde(default, flatten)]
    pub remote: OAuthProviderRemoteConfig,

    #[serde(default, flatten)]
    pub provider_oidc: OAuthProviderOidcConfig,

    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,

    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default)]
    pub required_scopes: Vec<String>,

    #[serde(default)]
    pub claims_check_script: Option<String>,

    #[serde(default)]
    pub pkce_enabled: bool,

    #[serde(default)]
    pub redirect_url: Option<String>,

    #[serde(default = "default_device_poll_interval", with = "humantime_serde")]
    pub device_poll_interval: Duration,
}

impl Default for TokenSetOidcSharedIntersectionConfig {
    fn default() -> Self {
        Self {
            client_id: None,
            client_secret: None,
            remote: OAuthProviderRemoteConfig::default(),
            provider_oidc: OAuthProviderOidcConfig::default(),
            scopes: default_scopes(),
            required_scopes: vec![],
            claims_check_script: None,
            pkce_enabled: false,
            redirect_url: None,
            device_poll_interval: default_device_poll_interval(),
        }
    }
}

impl TokenSetOidcSharedIntersectionConfig {
    fn apply_override(
        &self,
        override_config: &OptionalTokenSetOidcSharedIntersectionConfig,
    ) -> Self {
        Self {
            client_id: override_config
                .client_id
                .clone()
                .or_else(|| self.client_id.clone()),
            client_secret: override_config
                .client_secret
                .clone()
                .or_else(|| self.client_secret.clone()),
            remote: override_config.remote.apply_to(&self.remote),
            provider_oidc: override_config.provider_oidc.apply_to(&self.provider_oidc),
            scopes: override_config
                .scopes
                .clone()
                .unwrap_or_else(|| self.scopes.clone()),
            required_scopes: override_config
                .required_scopes
                .clone()
                .unwrap_or_else(|| self.required_scopes.clone()),
            claims_check_script: override_config
                .claims_check_script
                .clone()
                .or_else(|| self.claims_check_script.clone()),
            pkce_enabled: override_config.pkce_enabled.unwrap_or(self.pkce_enabled),
            redirect_url: override_config
                .redirect_url
                .clone()
                .or_else(|| self.redirect_url.clone()),
            device_poll_interval: override_config
                .device_poll_interval
                .unwrap_or(self.device_poll_interval),
        }
    }

    fn into_backend_raw_config<PC>(self, pending_store: Option<PC>) -> OidcClientRawConfig<PC>
    where
        PC: PendingOauthStoreConfig,
    {
        OidcClientRawConfig {
            client_id: self.client_id,
            client_secret: self.client_secret,
            remote: self.remote,
            provider_oidc: self.provider_oidc,
            scopes: self.scopes,
            required_scopes: self.required_scopes,
            claims_check_script: self.claims_check_script,
            pkce_enabled: self.pkce_enabled,
            redirect_url: self.redirect_url,
            pending_store,
            device_poll_interval: self.device_poll_interval,
        }
    }

    fn into_frontend_raw_config(self) -> OidcClientRawConfig<NoPendingStoreConfig> {
        OidcClientRawConfig {
            client_id: self.client_id,
            client_secret: self.client_secret,
            remote: self.remote,
            provider_oidc: self.provider_oidc,
            scopes: self.scopes,
            required_scopes: self.required_scopes,
            claims_check_script: self.claims_check_script,
            pkce_enabled: self.pkce_enabled,
            redirect_url: self.redirect_url,
            pending_store: None,
            device_poll_interval: self.device_poll_interval,
        }
    }
}

impl<PC> From<&OidcClientRawConfig<PC>> for TokenSetOidcSharedIntersectionConfig
where
    PC: PendingOauthStoreConfig,
{
    fn from(value: &OidcClientRawConfig<PC>) -> Self {
        Self {
            client_id: value.client_id.clone(),
            client_secret: value.client_secret.clone(),
            remote: value.remote.clone(),
            provider_oidc: value.provider_oidc.clone(),
            scopes: value.scopes.clone(),
            required_scopes: value.required_scopes.clone(),
            claims_check_script: value.claims_check_script.clone(),
            pkce_enabled: value.pkce_enabled,
            redirect_url: value.redirect_url.clone(),
            device_poll_interval: value.device_poll_interval,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct TokenSetOidcSharedUnionConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    #[serde(default, flatten)]
    pub oidc_client: TokenSetOidcSharedIntersectionConfig,

    #[serde(default, bound = "PC: PendingOauthStoreConfig")]
    pub pending_store: Option<PC>,

    #[serde(default, bound(deserialize = ""))]
    pub refresh_material_protection: RefreshMaterialProtection,

    #[serde(
        default,
        bound(deserialize = "MC: PendingAuthStateMetadataRedemptionConfig")
    )]
    pub metadata_delivery: MetadataDelivery<MC>,

    #[serde(default)]
    pub post_auth_redirect: PostAuthRedirectPolicy,

    #[serde(default, flatten)]
    pub frontend_capabilities: FrontendOidcModeCapabilities,
}

impl<PC, MC> TokenSetOidcSharedUnionConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub fn compose_backend_config(
        &self,
        override_config: &BackendOidcModeOverrideConfig<PC, MC>,
    ) -> BackendOidcModeConfig<PC, MC>
    where
        PC: Clone,
        MC: Clone,
    {
        let oidc_client = self
            .oidc_client
            .apply_override(&override_config.oidc_client)
            .into_backend_raw_config(
                override_config
                    .pending_store
                    .clone()
                    .or_else(|| self.pending_store.clone()),
            );

        BackendOidcModeConfig {
            oidc_client,
            refresh_material_protection: override_config
                .refresh_material_protection
                .clone()
                .unwrap_or_else(|| self.refresh_material_protection.clone()),
            metadata_delivery: override_config
                .metadata_delivery
                .clone()
                .unwrap_or_else(|| self.metadata_delivery.clone()),
            post_auth_redirect: override_config
                .post_auth_redirect
                .clone()
                .unwrap_or_else(|| self.post_auth_redirect.clone()),
        }
    }

    pub fn compose_frontend_config(
        &self,
        override_config: &FrontendOidcModeOverrideConfig,
    ) -> FrontendOidcModeConfig {
        FrontendOidcModeConfig {
            oidc_client: self
                .oidc_client
                .apply_override(&override_config.oidc_client)
                .into_frontend_raw_config(),
            capabilities: FrontendOidcModeCapabilities {
                unsafe_frontend_client_secret: override_config
                    .unsafe_frontend_client_secret
                    .unwrap_or(self.frontend_capabilities.unsafe_frontend_client_secret),
            },
        }
    }
}

impl<PC, MC> From<&BackendOidcModeConfig<PC, MC>> for TokenSetOidcSharedUnionConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn from(value: &BackendOidcModeConfig<PC, MC>) -> Self {
        Self {
            oidc_client: TokenSetOidcSharedIntersectionConfig::from(&value.oidc_client),
            pending_store: value.oidc_client.pending_store.clone(),
            refresh_material_protection: value.refresh_material_protection.clone(),
            metadata_delivery: value.metadata_delivery.clone(),
            post_auth_redirect: value.post_auth_redirect.clone(),
            frontend_capabilities: FrontendOidcModeCapabilities::default(),
        }
    }
}

#[serde_as]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OptionalOAuthProviderRemoteConfig {
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub well_known_url: Option<String>,

    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub issuer_url: Option<String>,

    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub jwks_uri: Option<String>,

    #[serde(default, with = "humantime_serde")]
    pub metadata_refresh_interval: Option<Duration>,

    #[serde(default, with = "humantime_serde")]
    pub jwks_refresh_interval: Option<Duration>,
}

impl OptionalOAuthProviderRemoteConfig {
    fn apply_to(&self, base: &OAuthProviderRemoteConfig) -> OAuthProviderRemoteConfig {
        OAuthProviderRemoteConfig {
            well_known_url: self
                .well_known_url
                .clone()
                .or_else(|| base.well_known_url.clone()),
            issuer_url: self.issuer_url.clone().or_else(|| base.issuer_url.clone()),
            jwks_uri: self.jwks_uri.clone().or_else(|| base.jwks_uri.clone()),
            metadata_refresh_interval: self
                .metadata_refresh_interval
                .unwrap_or(base.metadata_refresh_interval),
            jwks_refresh_interval: self
                .jwks_refresh_interval
                .unwrap_or(base.jwks_refresh_interval),
        }
    }
}

impl From<&OAuthProviderRemoteConfig> for OptionalOAuthProviderRemoteConfig {
    fn from(value: &OAuthProviderRemoteConfig) -> Self {
        Self {
            well_known_url: value.well_known_url.clone(),
            issuer_url: value.issuer_url.clone(),
            jwks_uri: value.jwks_uri.clone(),
            metadata_refresh_interval: Some(value.metadata_refresh_interval),
            jwks_refresh_interval: Some(value.jwks_refresh_interval),
        }
    }
}

#[serde_as]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OptionalOAuthProviderOidcConfig {
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

impl OptionalOAuthProviderOidcConfig {
    fn apply_to(&self, base: &OAuthProviderOidcConfig) -> OAuthProviderOidcConfig {
        OAuthProviderOidcConfig {
            authorization_endpoint: self
                .authorization_endpoint
                .clone()
                .or_else(|| base.authorization_endpoint.clone()),
            token_endpoint: self
                .token_endpoint
                .clone()
                .or_else(|| base.token_endpoint.clone()),
            userinfo_endpoint: self
                .userinfo_endpoint
                .clone()
                .or_else(|| base.userinfo_endpoint.clone()),
            introspection_endpoint: self
                .introspection_endpoint
                .clone()
                .or_else(|| base.introspection_endpoint.clone()),
            revocation_endpoint: self
                .revocation_endpoint
                .clone()
                .or_else(|| base.revocation_endpoint.clone()),
            device_authorization_endpoint: self
                .device_authorization_endpoint
                .clone()
                .or_else(|| base.device_authorization_endpoint.clone()),
            token_endpoint_auth_methods_supported: self
                .token_endpoint_auth_methods_supported
                .clone()
                .or_else(|| base.token_endpoint_auth_methods_supported.clone()),
            id_token_signing_alg_values_supported: self
                .id_token_signing_alg_values_supported
                .clone()
                .or_else(|| base.id_token_signing_alg_values_supported.clone()),
            userinfo_signing_alg_values_supported: self
                .userinfo_signing_alg_values_supported
                .clone()
                .or_else(|| base.userinfo_signing_alg_values_supported.clone()),
        }
    }
}

impl From<&OAuthProviderOidcConfig> for OptionalOAuthProviderOidcConfig {
    fn from(value: &OAuthProviderOidcConfig) -> Self {
        Self {
            authorization_endpoint: value.authorization_endpoint.clone(),
            token_endpoint: value.token_endpoint.clone(),
            userinfo_endpoint: value.userinfo_endpoint.clone(),
            introspection_endpoint: value.introspection_endpoint.clone(),
            revocation_endpoint: value.revocation_endpoint.clone(),
            device_authorization_endpoint: value.device_authorization_endpoint.clone(),
            token_endpoint_auth_methods_supported: value
                .token_endpoint_auth_methods_supported
                .clone(),
            id_token_signing_alg_values_supported: value
                .id_token_signing_alg_values_supported
                .clone(),
            userinfo_signing_alg_values_supported: value
                .userinfo_signing_alg_values_supported
                .clone(),
        }
    }
}

#[serde_as]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct OptionalTokenSetOidcSharedIntersectionConfig {
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_id: Option<String>,

    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_secret: Option<String>,

    #[serde(default, flatten)]
    pub remote: OptionalOAuthProviderRemoteConfig,

    #[serde(default, flatten)]
    pub provider_oidc: OptionalOAuthProviderOidcConfig,

    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<String>, _)>>")]
    #[serde(default)]
    pub scopes: Option<Vec<String>>,

    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<String>, _)>>")]
    #[serde(default)]
    pub required_scopes: Option<Vec<String>>,

    #[serde(default)]
    pub claims_check_script: Option<String>,

    #[serde(default)]
    pub pkce_enabled: Option<bool>,

    #[serde(default)]
    pub redirect_url: Option<String>,

    #[serde(default, with = "humantime_serde")]
    pub device_poll_interval: Option<Duration>,
}

impl<PC> From<&OidcClientRawConfig<PC>> for OptionalTokenSetOidcSharedIntersectionConfig
where
    PC: PendingOauthStoreConfig,
{
    fn from(value: &OidcClientRawConfig<PC>) -> Self {
        Self {
            client_id: value.client_id.clone(),
            client_secret: value.client_secret.clone(),
            remote: OptionalOAuthProviderRemoteConfig::from(&value.remote),
            provider_oidc: OptionalOAuthProviderOidcConfig::from(&value.provider_oidc),
            scopes: Some(value.scopes.clone()),
            required_scopes: Some(value.required_scopes.clone()),
            claims_check_script: value.claims_check_script.clone(),
            pkce_enabled: Some(value.pkce_enabled),
            redirect_url: value.redirect_url.clone(),
            device_poll_interval: Some(value.device_poll_interval),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct BackendOidcModeOverrideConfig<PC, MC>
where
    PC: PendingOauthStoreConfig,
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    #[serde(default, flatten)]
    pub oidc_client: OptionalTokenSetOidcSharedIntersectionConfig,

    #[serde(default, bound = "PC: PendingOauthStoreConfig")]
    pub pending_store: Option<PC>,

    #[serde(default)]
    pub refresh_material_protection: Option<RefreshMaterialProtection>,

    #[serde(
        default,
        bound(deserialize = "MC: PendingAuthStateMetadataRedemptionConfig")
    )]
    pub metadata_delivery: Option<MetadataDelivery<MC>>,

    #[serde(default)]
    pub post_auth_redirect: Option<PostAuthRedirectPolicy>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct FrontendOidcModeOverrideConfig {
    #[serde(default, flatten)]
    pub oidc_client: OptionalTokenSetOidcSharedIntersectionConfig,

    #[serde(default)]
    pub unsafe_frontend_client_secret: Option<UnsafeFrontendClientSecret>,
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;
    use crate::backend_oidc_mode::{
        BackendOidcModeRedirectUriConfig, MetadataDelivery, PostAuthRedirectPolicy,
    };

    #[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
    struct TestPendingStoreConfig {
        label: Option<String>,
    }

    impl PendingOauthStoreConfig for TestPendingStoreConfig {}

    #[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
    struct TestMetadataConfig;

    impl PendingAuthStateMetadataRedemptionConfig for TestMetadataConfig {}

    type SharedUnion = TokenSetOidcSharedUnionConfig<TestPendingStoreConfig, TestMetadataConfig>;

    #[test]
    fn compose_frontend_inherits_backend_oidc_client_fields() {
        let shared = SharedUnion {
            oidc_client: TokenSetOidcSharedIntersectionConfig {
                client_id: Some("shared-app".to_string()),
                scopes: vec!["openid".to_string(), "offline_access".to_string()],
                claims_check_script: Some("./custom-claims-check.mts".to_string()),
                pkce_enabled: true,
                ..Default::default()
            },
            ..Default::default()
        };

        let frontend = shared.compose_frontend_config(&FrontendOidcModeOverrideConfig::default());

        assert_eq!(
            frontend.oidc_client.client_id.as_deref(),
            Some("shared-app")
        );
        assert_eq!(
            frontend.oidc_client.scopes,
            vec!["openid".to_string(), "offline_access".to_string()]
        );
        assert_eq!(
            frontend.oidc_client.claims_check_script.as_deref(),
            Some("./custom-claims-check.mts")
        );
        assert!(frontend.oidc_client.pkce_enabled);
    }

    #[test]
    fn compose_frontend_preserves_explicit_false_and_empty_list_overrides() {
        let shared = SharedUnion {
            oidc_client: TokenSetOidcSharedIntersectionConfig {
                scopes: vec!["openid".to_string(), "offline_access".to_string()],
                pkce_enabled: true,
                ..Default::default()
            },
            ..Default::default()
        };
        let override_config = FrontendOidcModeOverrideConfig {
            oidc_client: OptionalTokenSetOidcSharedIntersectionConfig {
                scopes: Some(vec![]),
                pkce_enabled: Some(false),
                ..Default::default()
            },
            ..Default::default()
        };

        let frontend = shared.compose_frontend_config(&override_config);

        assert!(frontend.oidc_client.scopes.is_empty());
        assert!(!frontend.oidc_client.pkce_enabled);
    }

    #[test]
    fn compose_backend_replaces_whole_runtime_fields() {
        let shared = SharedUnion {
            post_auth_redirect: PostAuthRedirectPolicy::CallerValidated,
            metadata_delivery: MetadataDelivery::None,
            ..Default::default()
        };
        let override_config = BackendOidcModeOverrideConfig {
            post_auth_redirect: Some(PostAuthRedirectPolicy::Resolved {
                config: BackendOidcModeRedirectUriConfig::builder()
                    .dynamic_redirect_target_enabled(false)
                    .build(),
            }),
            metadata_delivery: Some(MetadataDelivery::None),
            ..Default::default()
        };

        let backend = shared.compose_backend_config(&override_config);

        assert!(matches!(
            backend.post_auth_redirect,
            PostAuthRedirectPolicy::Resolved { .. }
        ));
        assert!(matches!(backend.metadata_delivery, MetadataDelivery::None));
    }

    #[test]
    fn compose_backend_applies_pending_store_override() {
        let shared = SharedUnion {
            pending_store: Some(TestPendingStoreConfig {
                label: Some("shared".to_string()),
            }),
            ..Default::default()
        };
        let override_config = BackendOidcModeOverrideConfig {
            pending_store: Some(TestPendingStoreConfig {
                label: Some("backend".to_string()),
            }),
            ..Default::default()
        };

        let backend = shared.compose_backend_config(&override_config);

        assert_eq!(
            backend.oidc_client.pending_store,
            Some(TestPendingStoreConfig {
                label: Some("backend".to_string()),
            })
        );
    }
}
