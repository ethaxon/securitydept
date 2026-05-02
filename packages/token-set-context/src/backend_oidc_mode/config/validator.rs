use securitydept_oidc_client::PendingOauthStoreConfig;

use super::BackendOidcModeConfig;
use crate::backend_oidc_mode::PendingAuthStateMetadataRedemptionConfig;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendOidcModeConfigValidationError {
    pub mode: &'static str,
    pub field_path: String,
    pub code: String,
    pub message: String,
}

impl BackendOidcModeConfigValidationError {
    pub fn new(
        field_path: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            mode: "backend_oidc",
            field_path: field_path.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for BackendOidcModeConfigValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} config validation failed for {} ({}): {}",
            self.mode, self.field_path, self.code, self.message
        )
    }
}

impl std::error::Error for BackendOidcModeConfigValidationError {}

pub trait BackendOidcModeConfigValidator {
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopBackendOidcModeConfigValidator;

impl BackendOidcModeConfigValidator for NoopBackendOidcModeConfigValidator {
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        _config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendOidcModeFixedRedirectUriValidator {
    redirect_url: String,
}

impl BackendOidcModeFixedRedirectUriValidator {
    pub fn new(redirect_url: impl Into<String>) -> Self {
        Self {
            redirect_url: redirect_url.into(),
        }
    }

    pub fn redirect_url(&self) -> &str {
        &self.redirect_url
    }
}

impl BackendOidcModeConfigValidator for BackendOidcModeFixedRedirectUriValidator {
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        if config.oidc_client.redirect_url.is_some() {
            return Err(BackendOidcModeConfigValidationError::new(
                "redirect_url",
                "fixed_redirect_uri_conflict",
                format!(
                    "backend redirect_url is fixed by the host to {} and cannot be overridden",
                    self.redirect_url
                ),
            ));
        }

        Ok(())
    }
}

impl<V> BackendOidcModeConfigValidator for &V
where
    V: BackendOidcModeConfigValidator + ?Sized,
{
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        (*self).validate_raw_backend_oidc_mode_config(config)
    }
}

impl<V> BackendOidcModeConfigValidator for [V]
where
    V: BackendOidcModeConfigValidator,
{
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        for validator in self {
            validator.validate_raw_backend_oidc_mode_config(config)?;
        }

        Ok(())
    }
}

impl<V, const N: usize> BackendOidcModeConfigValidator for [V; N]
where
    V: BackendOidcModeConfigValidator,
{
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        self.as_slice()
            .validate_raw_backend_oidc_mode_config(config)
    }
}

impl<V> BackendOidcModeConfigValidator for Vec<V>
where
    V: BackendOidcModeConfigValidator,
{
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        self.as_slice()
            .validate_raw_backend_oidc_mode_config(config)
    }
}

impl<A, B> BackendOidcModeConfigValidator for (A, B)
where
    A: BackendOidcModeConfigValidator,
    B: BackendOidcModeConfigValidator,
{
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        self.0.validate_raw_backend_oidc_mode_config(config)?;
        self.1.validate_raw_backend_oidc_mode_config(config)
    }
}

impl<A, B, C> BackendOidcModeConfigValidator for (A, B, C)
where
    A: BackendOidcModeConfigValidator,
    B: BackendOidcModeConfigValidator,
    C: BackendOidcModeConfigValidator,
{
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &BackendOidcModeConfig<PC, MC>,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: PendingOauthStoreConfig,
        MC: PendingAuthStateMetadataRedemptionConfig,
    {
        self.0.validate_raw_backend_oidc_mode_config(config)?;
        self.1.validate_raw_backend_oidc_mode_config(config)?;
        self.2.validate_raw_backend_oidc_mode_config(config)
    }
}
