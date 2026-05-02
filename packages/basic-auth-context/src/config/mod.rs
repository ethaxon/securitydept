use securitydept_creds::{BasicAuthCred, BasicAuthCredsConfig};
use securitydept_realip::{RealIpAccessConfig, RealIpAccessManager};
use securitydept_utils::redirect::{RedirectTargetConfig, UriRelativeRedirectTargetResolver};
use serde::{Deserialize, Serialize};
use snafu::Snafu;
use typed_builder::TypedBuilder;

use crate::{BasicAuthContextError, BasicAuthContextResult};

pub mod validator;

pub use validator::{
    BasicAuthContextConfigValidationError, BasicAuthContextConfigValidator,
    BasicAuthContextFixedPostAuthRedirectValidator, BasicAuthContextFixedSingleZonePathValidator,
    BasicAuthContextRejectZonePostAuthRedirectOverrideValidator,
    NoopBasicAuthContextConfigValidator,
};

#[derive(Debug, Clone, Serialize, Deserialize, TypedBuilder)]
pub struct BasicAuthZoneConfig {
    #[builder(default = default_zone_prefix())]
    #[serde(default = "default_zone_prefix")]
    pub zone_prefix: String,
    #[builder(default = default_login_subpath())]
    #[serde(default = "default_login_subpath")]
    pub login_subpath: String,
    #[builder(default = default_logout_subpath())]
    #[serde(default = "default_logout_subpath")]
    pub logout_subpath: String,
    #[builder(default, setter(strip_option))]
    #[serde(default)]
    pub realm: Option<String>,
    #[serde(default)]
    #[builder(default, setter(strip_option))]
    pub post_auth_redirect: Option<RedirectTargetConfig>,
}

impl Default for BasicAuthZoneConfig {
    fn default() -> Self {
        Self {
            zone_prefix: default_zone_prefix(),
            login_subpath: default_login_subpath(),
            logout_subpath: default_logout_subpath(),
            realm: None,
            post_auth_redirect: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TypedBuilder)]
pub struct BasicAuthContextConfig<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    #[serde(
        flatten,
        bound = "Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>",
        default = "BasicAuthCredsConfig::default"
    )]
    #[builder(default = BasicAuthCredsConfig::default())]
    pub creds: BasicAuthCredsConfig<Creds>,
    #[serde(default)]
    #[builder(default, setter(strip_option))]
    pub real_ip_access: Option<RealIpAccessConfig>,
    #[serde(default)]
    #[builder(default = Vec::new())]
    pub zones: Vec<BasicAuthZoneConfig>,
    #[serde(default)]
    #[builder(default, setter(strip_option))]
    pub realm: Option<String>,
    #[serde(default = "default_post_auth_redirect")]
    #[builder(default = default_post_auth_redirect())]
    pub post_auth_redirect: RedirectTargetConfig,
}

impl<Creds> Default for BasicAuthContextConfig<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn default() -> Self {
        Self {
            creds: BasicAuthCredsConfig::default(),
            post_auth_redirect: default_post_auth_redirect(),
            real_ip_access: None,
            zones: Vec::new(),
            realm: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedBasicAuthZoneConfig {
    pub zone_prefix: String,
    pub login_subpath: String,
    pub logout_subpath: String,
    pub realm: String,
    pub post_auth_redirect: RedirectTargetConfig,
}

#[derive(Debug, Clone)]
pub struct ResolvedBasicAuthContextConfig<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    pub creds: BasicAuthCredsConfig<Creds>,
    pub real_ip_access: Option<RealIpAccessConfig>,
    pub zones: Vec<ResolvedBasicAuthZoneConfig>,
    pub realm: String,
    pub post_auth_redirect: RedirectTargetConfig,
}

#[derive(Debug, Snafu)]
pub enum BasicAuthContextConfigBuildError {
    #[snafu(transparent)]
    Validation {
        source: BasicAuthContextConfigValidationError,
    },
    #[snafu(transparent)]
    Context { source: BasicAuthContextError },
}

pub trait BasicAuthContextConfigSource<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn creds_config(&self) -> &BasicAuthCredsConfig<Creds>;
    fn real_ip_access_config(&self) -> Option<&RealIpAccessConfig>;
    fn zones_config(&self) -> &[BasicAuthZoneConfig];
    fn realm_config(&self) -> Option<&str>;
    fn post_auth_redirect_config(&self) -> &RedirectTargetConfig;

    fn resolve_creds_config(&self) -> BasicAuthCredsConfig<Creds>
    where
        Creds: Clone,
    {
        self.creds_config().clone()
    }

    fn resolve_real_ip_access_config(&self) -> BasicAuthContextResult<Option<RealIpAccessConfig>> {
        let config = self.real_ip_access_config().cloned();
        config
            .clone()
            .map(RealIpAccessManager::from_config)
            .transpose()
            .map_err(|source| BasicAuthContextError::RealIp { source })?;
        Ok(config)
    }

    fn resolve_realm_config(&self) -> String {
        self.realm_config()
            .map(ToOwned::to_owned)
            .unwrap_or_else(default_realm)
    }

    fn resolve_post_auth_redirect_config(&self) -> BasicAuthContextResult<RedirectTargetConfig> {
        let config = self.post_auth_redirect_config().clone();
        UriRelativeRedirectTargetResolver::from_config(config.clone())
            .map_err(|source| BasicAuthContextError::RedirectTarget { source })?;
        Ok(config)
    }

    fn resolve_zones_config(
        &self,
        default_realm: &str,
        default_post_auth_redirect: &RedirectTargetConfig,
    ) -> BasicAuthContextResult<Vec<ResolvedBasicAuthZoneConfig>> {
        self.zones_config()
            .iter()
            .cloned()
            .map(|zone| {
                resolve_basic_auth_zone_config(zone, default_realm, default_post_auth_redirect)
            })
            .collect()
    }

    fn resolve_all(
        &self,
    ) -> Result<ResolvedBasicAuthContextConfig<Creds>, BasicAuthContextConfigBuildError>
    where
        Creds: Clone,
    {
        let validator = NoopBasicAuthContextConfigValidator;
        self.resolve_all_with_validator(&validator)
    }

    fn resolve_all_with_validator<V>(
        &self,
        validator: &V,
    ) -> Result<ResolvedBasicAuthContextConfig<Creds>, BasicAuthContextConfigBuildError>
    where
        Creds: Clone,
        V: BasicAuthContextConfigValidator<Creds>,
    {
        validator
            .validate_basic_auth_context_config(self)
            .map_err(|source| BasicAuthContextConfigBuildError::Validation { source })?;

        let realm = self.resolve_realm_config();
        let post_auth_redirect = self
            .resolve_post_auth_redirect_config()
            .map_err(|source| BasicAuthContextConfigBuildError::Context { source })?;

        Ok(ResolvedBasicAuthContextConfig {
            creds: self.resolve_creds_config(),
            real_ip_access: self
                .resolve_real_ip_access_config()
                .map_err(|source| BasicAuthContextConfigBuildError::Context { source })?,
            zones: self
                .resolve_zones_config(&realm, &post_auth_redirect)
                .map_err(|source| BasicAuthContextConfigBuildError::Context { source })?,
            realm,
            post_auth_redirect,
        })
    }
}

impl<Creds> BasicAuthContextConfigSource<Creds> for BasicAuthContextConfig<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    fn creds_config(&self) -> &BasicAuthCredsConfig<Creds> {
        &self.creds
    }

    fn real_ip_access_config(&self) -> Option<&RealIpAccessConfig> {
        self.real_ip_access.as_ref()
    }

    fn zones_config(&self) -> &[BasicAuthZoneConfig] {
        &self.zones
    }

    fn realm_config(&self) -> Option<&str> {
        self.realm.as_deref()
    }

    fn post_auth_redirect_config(&self) -> &RedirectTargetConfig {
        &self.post_auth_redirect
    }
}

pub(crate) fn default_zone_prefix() -> String {
    "/basic".to_string()
}

pub(crate) fn default_login_subpath() -> String {
    "/login".to_string()
}

pub(crate) fn default_logout_subpath() -> String {
    "/logout".to_string()
}

pub(crate) fn default_post_auth_redirect() -> RedirectTargetConfig {
    RedirectTargetConfig::strict_default("/")
}

pub(crate) fn default_realm() -> String {
    "securitydept".to_string()
}

pub(crate) fn resolve_basic_auth_zone_config(
    zone: BasicAuthZoneConfig,
    default_realm: &str,
    default_post_auth_redirect: &RedirectTargetConfig,
) -> BasicAuthContextResult<ResolvedBasicAuthZoneConfig> {
    let post_auth_redirect = zone
        .post_auth_redirect
        .unwrap_or_else(|| default_post_auth_redirect.clone());
    UriRelativeRedirectTargetResolver::from_config(post_auth_redirect.clone())
        .map_err(|source| BasicAuthContextError::RedirectTarget { source })?;

    Ok(ResolvedBasicAuthZoneConfig {
        zone_prefix: zone.zone_prefix,
        login_subpath: zone.login_subpath,
        logout_subpath: zone.logout_subpath,
        realm: zone.realm.unwrap_or_else(|| default_realm.to_string()),
        post_auth_redirect,
    })
}
