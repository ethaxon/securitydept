use std::{fmt, sync::Arc};

use snafu::Snafu;
use typed_builder::TypedBuilder;

use crate::{
    AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector, RefreshMaterialError,
    RefreshMaterialProtector, SealedRefreshMaterial,
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
    redirect::{TokenSetRedirectUriConfig, TokenSetRedirectUriError},
};

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, TypedBuilder, Default,
)]
pub struct TokenSetContextConfig {
    #[builder(default)]
    #[serde(default)]
    pub master_key: Option<String>,
    #[builder(default)]
    #[serde(default)]
    pub sealed_refresh_token: bool,
    #[builder(default)]
    #[serde(default)]
    pub metadata_redemption: PendingAuthStateMetadataRedemptionConfig,
    #[builder(default)]
    #[serde(default)]
    pub redirect_uri: TokenSetRedirectUriConfig,
}

#[derive(Debug, Snafu)]
pub enum TokenSetContextError {
    #[snafu(display("token-set context is misconfigured: {message}"))]
    ContextConfig { message: String },
    #[snafu(display("refresh material operation failed: {source}"))]
    RefreshMaterial { source: RefreshMaterialError },
    #[snafu(display("redirect uri operation failed: {source}"))]
    RedirectUri { source: TokenSetRedirectUriError },
}

#[derive(Clone)]
pub struct TokenSetContext {
    refresh_material_protector: Arc<dyn RefreshMaterialProtector>,
    redirect_uri: TokenSetRedirectUriConfig,
}

impl fmt::Debug for TokenSetContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TokenSetContext { refresh_material_protector: REDACTED }")
    }
}

impl TokenSetContextConfig {
    pub fn validate(&self) -> Result<(), TokenSetContextError> {
        if self.sealed_refresh_token
            && self
                .master_key
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err(TokenSetContextError::ContextConfig {
                message: "master_key is required when sealed_refresh_token is enabled".to_string(),
            });
        }

        self.redirect_uri
            .validate()
            .map_err(|source| TokenSetContextError::RedirectUri { source })?;

        Ok(())
    }
}

impl TokenSetContext {
    pub fn from_config(config: &TokenSetContextConfig) -> Result<Self, TokenSetContextError> {
        config.validate()?;

        let refresh_material_protector: Arc<dyn RefreshMaterialProtector> =
            if config.sealed_refresh_token {
                let master_key = config.master_key.as_deref().ok_or_else(|| {
                    TokenSetContextError::ContextConfig {
                        message: "master_key is required when sealed_refresh_token is enabled"
                            .to_string(),
                    }
                })?;

                Arc::new(
                    AeadRefreshMaterialProtector::from_master_key(master_key)
                        .map_err(|source| TokenSetContextError::RefreshMaterial { source })?,
                )
            } else {
                Arc::new(PassthroughRefreshMaterialProtector)
            };

        Ok(Self {
            refresh_material_protector,
            redirect_uri: config.redirect_uri.clone(),
        })
    }

    pub fn seal_refresh_token(
        &self,
        refresh_token: &str,
    ) -> Result<SealedRefreshMaterial, TokenSetContextError> {
        self.refresh_material_protector
            .seal(refresh_token)
            .map_err(|source| TokenSetContextError::RefreshMaterial { source })
    }

    pub fn unseal_refresh_token(
        &self,
        material: &SealedRefreshMaterial,
    ) -> Result<String, TokenSetContextError> {
        self.refresh_material_protector
            .unseal(material)
            .map_err(|source| TokenSetContextError::RefreshMaterial { source })
    }

    pub fn resolve_redirect_uri(
        &self,
        requested_redirect_uri: Option<&str>,
    ) -> Result<url::Url, TokenSetContextError> {
        self.redirect_uri
            .resolve_redirect_uri(requested_redirect_uri)
            .map_err(|source| TokenSetContextError::RedirectUri { source })
    }
}
