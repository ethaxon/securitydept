use super::FrontendOidcModeConfig;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrontendOidcModeConfigValidationError {
    pub mode: &'static str,
    pub field_path: String,
    pub code: String,
    pub message: String,
}

impl FrontendOidcModeConfigValidationError {
    pub fn new(
        field_path: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            mode: "frontend_oidc",
            field_path: field_path.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for FrontendOidcModeConfigValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} config validation failed for {} ({}): {}",
            self.mode, self.field_path, self.code, self.message
        )
    }
}

impl std::error::Error for FrontendOidcModeConfigValidationError {}

pub trait FrontendOidcModeConfigValidator {
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopFrontendOidcModeConfigValidator;

impl FrontendOidcModeConfigValidator for NoopFrontendOidcModeConfigValidator {
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        _config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrontendOidcModeFixedRedirectUriValidator {
    redirect_url: String,
}

impl FrontendOidcModeFixedRedirectUriValidator {
    pub fn new(redirect_url: impl Into<String>) -> Self {
        Self {
            redirect_url: redirect_url.into(),
        }
    }

    pub fn redirect_url(&self) -> &str {
        &self.redirect_url
    }
}

impl FrontendOidcModeConfigValidator for FrontendOidcModeFixedRedirectUriValidator {
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        if config.oidc_client.redirect_url.is_some() {
            return Err(FrontendOidcModeConfigValidationError::new(
                "redirect_url",
                "fixed_redirect_uri_conflict",
                format!(
                    "frontend redirect_url is fixed by the host to {} and cannot be overridden",
                    self.redirect_url
                ),
            ));
        }

        Ok(())
    }
}

impl<V> FrontendOidcModeConfigValidator for &V
where
    V: FrontendOidcModeConfigValidator + ?Sized,
{
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        (*self).validate_raw_frontend_oidc_mode_config(config)
    }
}

impl<V> FrontendOidcModeConfigValidator for [V]
where
    V: FrontendOidcModeConfigValidator,
{
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        for validator in self {
            validator.validate_raw_frontend_oidc_mode_config(config)?;
        }

        Ok(())
    }
}

impl<V, const N: usize> FrontendOidcModeConfigValidator for [V; N]
where
    V: FrontendOidcModeConfigValidator,
{
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        self.as_slice()
            .validate_raw_frontend_oidc_mode_config(config)
    }
}

impl<V> FrontendOidcModeConfigValidator for Vec<V>
where
    V: FrontendOidcModeConfigValidator,
{
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        self.as_slice()
            .validate_raw_frontend_oidc_mode_config(config)
    }
}

impl<A, B> FrontendOidcModeConfigValidator for (A, B)
where
    A: FrontendOidcModeConfigValidator,
    B: FrontendOidcModeConfigValidator,
{
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        self.0.validate_raw_frontend_oidc_mode_config(config)?;
        self.1.validate_raw_frontend_oidc_mode_config(config)
    }
}

impl<A, B, C> FrontendOidcModeConfigValidator for (A, B, C)
where
    A: FrontendOidcModeConfigValidator,
    B: FrontendOidcModeConfigValidator,
    C: FrontendOidcModeConfigValidator,
{
    fn validate_raw_frontend_oidc_mode_config(
        &self,
        config: &FrontendOidcModeConfig,
    ) -> Result<(), FrontendOidcModeConfigValidationError> {
        self.0.validate_raw_frontend_oidc_mode_config(config)?;
        self.1.validate_raw_frontend_oidc_mode_config(config)?;
        self.2.validate_raw_frontend_oidc_mode_config(config)
    }
}
