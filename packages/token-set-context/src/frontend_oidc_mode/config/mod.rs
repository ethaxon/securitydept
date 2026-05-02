//! Configuration types for `frontend-oidc` mode.

use securitydept_oauth_provider::OidcSharedConfig;
use serde::Deserialize;

pub mod validator;

pub use validator::{
    FrontendOidcModeConfigValidationError, FrontendOidcModeConfigValidator,
    FrontendOidcModeFixedRedirectUriValidator, NoopFrontendOidcModeConfigValidator,
};

use super::{
    capabilities::FrontendOidcModeCapabilities,
    contracts::{FrontendOidcModeClaimsCheckScript, FrontendOidcModeConfigProjection},
};
use crate::orchestration::{BackendConfigError, OidcClientConfig, OidcClientRawConfig};

#[cfg_attr(feature = "config-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Default, Deserialize)]
pub struct NoPendingStoreConfig;

impl securitydept_oidc_client::PendingOauthStoreConfig for NoPendingStoreConfig {}

pub trait FrontendOidcModeConfigSource {
    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<NoPendingStoreConfig>;
    fn capabilities(&self) -> &FrontendOidcModeCapabilities;

    fn raw_frontend_oidc_mode_config(&self) -> FrontendOidcModeConfig {
        FrontendOidcModeConfig {
            oidc_client: self.oidc_client_raw_config().clone(),
            capabilities: self.capabilities().clone(),
        }
    }

    fn resolve_oidc_client(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<OidcClientConfig<NoPendingStoreConfig>, BackendConfigError> {
        self.oidc_client_raw_config()
            .clone()
            .resolve_config(shared)
            .map_err(Into::into)
    }

    fn resolve_all(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<ResolvedFrontendOidcModeConfig, BackendConfigError> {
        let validator = NoopFrontendOidcModeConfigValidator;
        self.resolve_all_with_validator(shared, &validator)
    }

    fn resolve_all_with_validator<V>(
        &self,
        shared: &OidcSharedConfig,
        validator: &V,
    ) -> Result<ResolvedFrontendOidcModeConfig, BackendConfigError>
    where
        V: FrontendOidcModeConfigValidator,
    {
        let raw_config = self.raw_frontend_oidc_mode_config();
        validator
            .validate_raw_frontend_oidc_mode_config(&raw_config)
            .map_err(BackendConfigError::FrontendOidcModeValidation)?;
        let oidc_client = self.resolve_oidc_client(shared)?;

        Ok(ResolvedFrontendOidcModeConfig {
            oidc_client,
            capabilities: self.capabilities().clone(),
        })
    }
}

#[cfg_attr(feature = "config-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct FrontendOidcModeConfig {
    #[serde(default, flatten)]
    pub oidc_client: OidcClientRawConfig<NoPendingStoreConfig>,
    #[serde(default, flatten)]
    pub capabilities: FrontendOidcModeCapabilities,
}

impl FrontendOidcModeConfigSource for FrontendOidcModeConfig {
    fn oidc_client_raw_config(&self) -> &OidcClientRawConfig<NoPendingStoreConfig> {
        &self.oidc_client
    }

    fn capabilities(&self) -> &FrontendOidcModeCapabilities {
        &self.capabilities
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedFrontendOidcModeConfig {
    pub oidc_client: OidcClientConfig<NoPendingStoreConfig>,
    pub capabilities: FrontendOidcModeCapabilities,
}

impl ResolvedFrontendOidcModeConfig {
    pub async fn to_config_projection(&self) -> std::io::Result<FrontendOidcModeConfigProjection> {
        let client_secret = if self.capabilities.unsafe_frontend_client_secret.is_enabled() {
            self.oidc_client
                .client_secret
                .as_ref()
                .map(|value| value.expose_secret().to_owned())
        } else {
            None
        };

        let claims_check_script = match self.oidc_client.claims_check_script.as_deref() {
            Some(path) => Some(FrontendOidcModeClaimsCheckScript::from_path(path).await?),
            None => None,
        };

        Ok(FrontendOidcModeConfigProjection {
            well_known_url: self.oidc_client.remote.well_known_url.clone(),
            issuer_url: self.oidc_client.remote.issuer_url.clone(),
            jwks_uri: self.oidc_client.remote.jwks_uri.clone(),
            metadata_refresh_interval: self.oidc_client.remote.metadata_refresh_interval,
            jwks_refresh_interval: self.oidc_client.remote.jwks_refresh_interval,
            authorization_endpoint: self
                .oidc_client
                .provider_oidc
                .authorization_endpoint
                .clone(),
            token_endpoint: self.oidc_client.provider_oidc.token_endpoint.clone(),
            userinfo_endpoint: self.oidc_client.provider_oidc.userinfo_endpoint.clone(),
            revocation_endpoint: self.oidc_client.provider_oidc.revocation_endpoint.clone(),
            token_endpoint_auth_methods_supported: self
                .oidc_client
                .provider_oidc
                .token_endpoint_auth_methods_supported
                .as_ref()
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|algorithm| serde_json::to_value(algorithm).ok())
                        .filter_map(|value| value.as_str().map(|text| text.to_owned()))
                        .collect()
                }),
            id_token_signing_alg_values_supported: self
                .oidc_client
                .provider_oidc
                .id_token_signing_alg_values_supported
                .as_ref()
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|algorithm| serde_json::to_value(algorithm).ok())
                        .filter_map(|value| value.as_str().map(|text| text.to_owned()))
                        .collect()
                }),
            userinfo_signing_alg_values_supported: self
                .oidc_client
                .provider_oidc
                .userinfo_signing_alg_values_supported
                .as_ref()
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|algorithm| serde_json::to_value(algorithm).ok())
                        .filter_map(|value| value.as_str().map(|text| text.to_owned()))
                        .collect()
                }),
            client_id: self.oidc_client.client_id.clone(),
            client_secret,
            scopes: self.oidc_client.scopes.clone(),
            required_scopes: self.oidc_client.required_scopes.clone(),
            redirect_url: self.oidc_client.redirect_url.clone(),
            pkce_enabled: self.oidc_client.pkce_enabled,
            claims_check_script,
            generated_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};
    use securitydept_utils::secret::SecretString;

    use super::*;

    fn shared_config() -> OidcSharedConfig {
        OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            client_secret: Some(SecretString::from("shared-secret")),
            ..Default::default()
        }
    }

    #[test]
    fn resolve_inherits_client_id_from_shared() {
        let raw = FrontendOidcModeConfig::default();
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(resolved.oidc_client.client_id, "shared-app");
    }

    #[test]
    fn local_client_id_overrides_shared() {
        let raw = FrontendOidcModeConfig {
            oidc_client: OidcClientRawConfig {
                client_id: Some("local-spa".to_string()),
                ..Default::default()
            },
            capabilities: Default::default(),
        };
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(resolved.oidc_client.client_id, "local-spa");
    }

    #[test]
    fn resolve_inherits_well_known_url_from_shared() {
        let raw = FrontendOidcModeConfig::default();
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(
            resolved.oidc_client.remote.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration"),
        );
    }

    #[test]
    fn resolve_fails_without_client_id() {
        let shared = OidcSharedConfig::default();
        let raw = FrontendOidcModeConfig::default();
        let err = raw.resolve_all(&shared).unwrap_err();
        assert!(err.to_string().contains("client_id must be set"));
    }

    #[tokio::test]
    async fn projection_reflects_resolved_config() {
        let raw = FrontendOidcModeConfig {
            oidc_client: OidcClientRawConfig {
                redirect_url: Some("https://app.example.com/callback".to_string()),
                pkce_enabled: true,
                ..Default::default()
            },
            capabilities: Default::default(),
        };
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        let projection = resolved
            .to_config_projection()
            .await
            .expect("projection should succeed");

        assert_eq!(
            projection.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration")
        );
        assert_eq!(projection.client_id, "shared-app");
        assert_eq!(projection.redirect_url, "https://app.example.com/callback");
        assert!(projection.pkce_enabled);
        assert!(projection.client_secret.is_none());
        assert!(projection.authorization_endpoint.is_none());
        assert!(projection.token_endpoint.is_none());
        assert!(projection.userinfo_endpoint.is_none());
    }

    #[test]
    fn default_scopes_applied() {
        let raw = FrontendOidcModeConfig::default();
        let resolved = raw.resolve_all(&shared_config()).expect("should resolve");
        assert_eq!(
            resolved.oidc_client.scopes,
            vec![
                "openid".to_string(),
                "profile".to_string(),
                "email".to_string()
            ]
        );
    }

    #[test]
    fn fixed_redirect_validator_overrides_resolved_frontend_redirect_url() {
        let raw = FrontendOidcModeConfig::default();
        let fixed_redirect = FrontendOidcModeFixedRedirectUriValidator::new(
            "/auth/token-set/frontend-mode/callback",
        );

        let resolved = raw
            .resolve_all_with_validator(&shared_config(), &fixed_redirect)
            .expect("should resolve with fixed redirect validator");
        let mut resolved = resolved;
        resolved.oidc_client.redirect_url = fixed_redirect.redirect_url().to_string();

        assert_eq!(
            resolved.oidc_client.redirect_url,
            "/auth/token-set/frontend-mode/callback"
        );
    }

    #[test]
    fn fixed_redirect_validator_rejects_user_redirect_override() {
        let raw = FrontendOidcModeConfig {
            oidc_client: OidcClientRawConfig {
                redirect_url: Some("/custom-callback".to_string()),
                ..Default::default()
            },
            capabilities: Default::default(),
        };
        let fixed_redirect = FrontendOidcModeFixedRedirectUriValidator::new(
            "/auth/token-set/frontend-mode/callback",
        );
        let err = raw
            .resolve_all_with_validator(&shared_config(), &fixed_redirect)
            .unwrap_err();

        assert!(matches!(
            err,
            BackendConfigError::FrontendOidcModeValidation(ref error)
                if error.field_path == "redirect_url"
                    && error.code == "fixed_redirect_uri_conflict"
        ));
    }
}
