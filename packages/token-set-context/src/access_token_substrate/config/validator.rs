use super::AccessTokenSubstrateConfig;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessTokenSubstrateConfigValidationError {
    pub mode: &'static str,
    pub field_path: String,
    pub code: String,
    pub message: String,
}

impl AccessTokenSubstrateConfigValidationError {
    pub fn new(
        field_path: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            mode: "access_token_substrate",
            field_path: field_path.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AccessTokenSubstrateConfigValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} config validation failed for {} ({}): {}",
            self.mode, self.field_path, self.code, self.message
        )
    }
}

impl std::error::Error for AccessTokenSubstrateConfigValidationError {}

pub trait AccessTokenSubstrateConfigValidator {
    fn validate_raw_access_token_substrate_config(
        &self,
        config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopAccessTokenSubstrateConfigValidator;

impl AccessTokenSubstrateConfigValidator for NoopAccessTokenSubstrateConfigValidator {
    fn validate_raw_access_token_substrate_config(
        &self,
        _config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError> {
        Ok(())
    }
}

impl<V> AccessTokenSubstrateConfigValidator for &V
where
    V: AccessTokenSubstrateConfigValidator + ?Sized,
{
    fn validate_raw_access_token_substrate_config(
        &self,
        config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError> {
        (*self).validate_raw_access_token_substrate_config(config)
    }
}

impl<V> AccessTokenSubstrateConfigValidator for [V]
where
    V: AccessTokenSubstrateConfigValidator,
{
    fn validate_raw_access_token_substrate_config(
        &self,
        config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError> {
        for validator in self {
            validator.validate_raw_access_token_substrate_config(config)?;
        }

        Ok(())
    }
}

impl<V, const N: usize> AccessTokenSubstrateConfigValidator for [V; N]
where
    V: AccessTokenSubstrateConfigValidator,
{
    fn validate_raw_access_token_substrate_config(
        &self,
        config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError> {
        self.as_slice()
            .validate_raw_access_token_substrate_config(config)
    }
}

impl<V> AccessTokenSubstrateConfigValidator for Vec<V>
where
    V: AccessTokenSubstrateConfigValidator,
{
    fn validate_raw_access_token_substrate_config(
        &self,
        config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError> {
        self.as_slice()
            .validate_raw_access_token_substrate_config(config)
    }
}

impl<A, B> AccessTokenSubstrateConfigValidator for (A, B)
where
    A: AccessTokenSubstrateConfigValidator,
    B: AccessTokenSubstrateConfigValidator,
{
    fn validate_raw_access_token_substrate_config(
        &self,
        config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError> {
        self.0.validate_raw_access_token_substrate_config(config)?;
        self.1.validate_raw_access_token_substrate_config(config)
    }
}

impl<A, B, C> AccessTokenSubstrateConfigValidator for (A, B, C)
where
    A: AccessTokenSubstrateConfigValidator,
    B: AccessTokenSubstrateConfigValidator,
    C: AccessTokenSubstrateConfigValidator,
{
    fn validate_raw_access_token_substrate_config(
        &self,
        config: &AccessTokenSubstrateConfig,
    ) -> Result<(), AccessTokenSubstrateConfigValidationError> {
        self.0.validate_raw_access_token_substrate_config(config)?;
        self.1.validate_raw_access_token_substrate_config(config)?;
        self.2.validate_raw_access_token_substrate_config(config)
    }
}
