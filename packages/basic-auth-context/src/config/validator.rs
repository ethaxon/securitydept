use securitydept_creds::BasicAuthCred;
use securitydept_utils::redirect::RedirectTargetConfig;
use serde::{Deserialize, Serialize};

use super::BasicAuthContextConfigSource;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BasicAuthContextConfigValidationError {
    pub field_path: String,
    pub code: String,
    pub message: String,
}

impl BasicAuthContextConfigValidationError {
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

impl std::fmt::Display for BasicAuthContextConfigValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "basic_auth_context config validation failed for {} ({}): {}",
            self.field_path, self.code, self.message
        )
    }
}

impl std::error::Error for BasicAuthContextConfigValidationError {}

pub trait BasicAuthContextConfigValidator<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopBasicAuthContextConfigValidator;

impl<Creds> BasicAuthContextConfigValidator<Creds> for NoopBasicAuthContextConfigValidator
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        _config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        Ok(())
    }
}

impl<Creds, V> BasicAuthContextConfigValidator<Creds> for &V
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
    V: BasicAuthContextConfigValidator<Creds> + ?Sized,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        (*self).validate_basic_auth_context_config(config)
    }
}

impl<Creds, V> BasicAuthContextConfigValidator<Creds> for [V]
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
    V: BasicAuthContextConfigValidator<Creds>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        for validator in self {
            validator.validate_basic_auth_context_config(config)?;
        }

        Ok(())
    }
}

impl<Creds, V, const N: usize> BasicAuthContextConfigValidator<Creds> for [V; N]
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
    V: BasicAuthContextConfigValidator<Creds>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        self.as_slice().validate_basic_auth_context_config(config)
    }
}

impl<Creds, V> BasicAuthContextConfigValidator<Creds> for Vec<V>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
    V: BasicAuthContextConfigValidator<Creds>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        self.as_slice().validate_basic_auth_context_config(config)
    }
}

impl<Creds, A, B> BasicAuthContextConfigValidator<Creds> for (A, B)
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
    A: BasicAuthContextConfigValidator<Creds>,
    B: BasicAuthContextConfigValidator<Creds>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        self.0.validate_basic_auth_context_config(config)?;
        self.1.validate_basic_auth_context_config(config)
    }
}

impl<Creds, A, B, C> BasicAuthContextConfigValidator<Creds> for (A, B, C)
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
    A: BasicAuthContextConfigValidator<Creds>,
    B: BasicAuthContextConfigValidator<Creds>,
    C: BasicAuthContextConfigValidator<Creds>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        self.0.validate_basic_auth_context_config(config)?;
        self.1.validate_basic_auth_context_config(config)?;
        self.2.validate_basic_auth_context_config(config)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BasicAuthContextFixedSingleZonePathValidator {
    zone_prefix: String,
    login_subpath: String,
    logout_subpath: String,
}

impl BasicAuthContextFixedSingleZonePathValidator {
    pub fn new(
        zone_prefix: impl Into<String>,
        login_subpath: impl Into<String>,
        logout_subpath: impl Into<String>,
    ) -> Self {
        Self {
            zone_prefix: zone_prefix.into(),
            login_subpath: login_subpath.into(),
            logout_subpath: logout_subpath.into(),
        }
    }
}

impl<Creds> BasicAuthContextConfigValidator<Creds> for BasicAuthContextFixedSingleZonePathValidator
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        if config.zones_config().len() != 1 {
            return Err(BasicAuthContextConfigValidationError::new(
                "zones",
                "fixed_single_zone_required",
                "expected exactly one basic-auth zone for the fixed single-zone host policy",
            ));
        }

        let zone = &config.zones_config()[0];
        if zone.zone_prefix != self.zone_prefix {
            return Err(BasicAuthContextConfigValidationError::new(
                "zones[0].zone_prefix",
                "fixed_zone_path_conflict",
                format!(
                    "basic-auth zone_prefix is fixed by the host to {}",
                    self.zone_prefix
                ),
            ));
        }
        if zone.login_subpath != self.login_subpath {
            return Err(BasicAuthContextConfigValidationError::new(
                "zones[0].login_subpath",
                "fixed_zone_path_conflict",
                format!(
                    "basic-auth login_subpath is fixed by the host to {}",
                    self.login_subpath
                ),
            ));
        }
        if zone.logout_subpath != self.logout_subpath {
            return Err(BasicAuthContextConfigValidationError::new(
                "zones[0].logout_subpath",
                "fixed_zone_path_conflict",
                format!(
                    "basic-auth logout_subpath is fixed by the host to {}",
                    self.logout_subpath
                ),
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BasicAuthContextFixedPostAuthRedirectValidator {
    post_auth_redirect: RedirectTargetConfig,
}

impl BasicAuthContextFixedPostAuthRedirectValidator {
    pub fn new(post_auth_redirect: RedirectTargetConfig) -> Self {
        Self { post_auth_redirect }
    }
}

impl<Creds> BasicAuthContextConfigValidator<Creds>
    for BasicAuthContextFixedPostAuthRedirectValidator
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        if config.post_auth_redirect_config() != &self.post_auth_redirect {
            return Err(BasicAuthContextConfigValidationError::new(
                "post_auth_redirect",
                "fixed_post_auth_redirect_conflict",
                "basic-auth post_auth_redirect is fixed by the host and cannot be overridden",
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BasicAuthContextRejectZonePostAuthRedirectOverrideValidator;

impl<Creds> BasicAuthContextConfigValidator<Creds>
    for BasicAuthContextRejectZonePostAuthRedirectOverrideValidator
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn validate_basic_auth_context_config<S>(
        &self,
        config: &S,
    ) -> Result<(), BasicAuthContextConfigValidationError>
    where
        S: BasicAuthContextConfigSource<Creds> + ?Sized,
    {
        if let Some((index, _)) = config
            .zones_config()
            .iter()
            .enumerate()
            .find(|(_, zone)| zone.post_auth_redirect.is_some())
        {
            return Err(BasicAuthContextConfigValidationError::new(
                format!("zones[{index}].post_auth_redirect"),
                "zone_post_auth_redirect_override_forbidden",
                "zone-level basic-auth post_auth_redirect overrides are forbidden by the host",
            ));
        }

        Ok(())
    }
}
