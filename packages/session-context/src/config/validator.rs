use securitydept_utils::redirect::RedirectTargetConfig;

use super::SessionContextConfigSource;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionContextConfigValidationError {
    pub field_path: String,
    pub code: String,
    pub message: String,
}

impl SessionContextConfigValidationError {
    pub fn new(
        field_path: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            field_path: field_path.into(),
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SessionContextConfigValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "session_context config validation failed for {} ({}): {}",
            self.field_path, self.code, self.message
        )
    }
}

impl std::error::Error for SessionContextConfigValidationError {}

pub trait SessionContextConfigValidator {
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopSessionContextConfigValidator;

impl SessionContextConfigValidator for NoopSessionContextConfigValidator {
    fn validate_session_context_config<S>(
        &self,
        _config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        Ok(())
    }
}

impl<V> SessionContextConfigValidator for &V
where
    V: SessionContextConfigValidator + ?Sized,
{
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        (*self).validate_session_context_config(config)
    }
}

impl<V> SessionContextConfigValidator for [V]
where
    V: SessionContextConfigValidator,
{
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        for validator in self {
            validator.validate_session_context_config(config)?;
        }

        Ok(())
    }
}

impl<V, const N: usize> SessionContextConfigValidator for [V; N]
where
    V: SessionContextConfigValidator,
{
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        self.as_slice().validate_session_context_config(config)
    }
}

impl<V> SessionContextConfigValidator for Vec<V>
where
    V: SessionContextConfigValidator,
{
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        self.as_slice().validate_session_context_config(config)
    }
}

impl<A, B> SessionContextConfigValidator for (A, B)
where
    A: SessionContextConfigValidator,
    B: SessionContextConfigValidator,
{
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        self.0.validate_session_context_config(config)?;
        self.1.validate_session_context_config(config)
    }
}

impl<A, B, C> SessionContextConfigValidator for (A, B, C)
where
    A: SessionContextConfigValidator,
    B: SessionContextConfigValidator,
    C: SessionContextConfigValidator,
{
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        self.0.validate_session_context_config(config)?;
        self.1.validate_session_context_config(config)?;
        self.2.validate_session_context_config(config)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionContextFixedPostAuthRedirectValidator {
    post_auth_redirect: RedirectTargetConfig,
}

impl SessionContextFixedPostAuthRedirectValidator {
    pub fn new(post_auth_redirect: RedirectTargetConfig) -> Self {
        Self { post_auth_redirect }
    }
}

impl SessionContextConfigValidator for SessionContextFixedPostAuthRedirectValidator {
    fn validate_session_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), SessionContextConfigValidationError>
    where
        S: SessionContextConfigSource + ?Sized,
    {
        if config.post_auth_redirect_config() != &self.post_auth_redirect {
            return Err(SessionContextConfigValidationError::new(
                "post_auth_redirect",
                "fixed_post_auth_redirect_conflict",
                "session post_auth_redirect is fixed by the host and cannot be overridden",
            ));
        }

        Ok(())
    }
}
