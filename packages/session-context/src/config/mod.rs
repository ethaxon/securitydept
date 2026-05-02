use std::time::Duration as StdDuration;

use securitydept_utils::redirect::{RedirectTargetConfig, UriRelativeRedirectTargetResolver};
use serde::{Deserialize, Serialize};
use snafu::Snafu;
use typed_builder::TypedBuilder;

use crate::{SessionContextError, SessionContextResult, SessionCookieSameSite};

pub mod validator;

pub use validator::{
    NoopSessionContextConfigValidator, SessionContextConfigValidationError,
    SessionContextConfigValidator, SessionContextFixedPostAuthRedirectValidator,
};

#[derive(Debug, Clone, Serialize, Deserialize, TypedBuilder)]
pub struct SessionContextConfig {
    #[builder(default = crate::DEFAULT_COOKIE_NAME.to_string())]
    #[serde(default = "default_cookie_name")]
    pub cookie_name: String,
    #[builder(default = crate::DEFAULT_SESSION_CONTEXT_KEY.to_string())]
    #[serde(default = "default_session_context_key")]
    pub session_context_key: String,
    #[builder(default = "/".to_string())]
    #[serde(default = "default_cookie_path")]
    pub cookie_path: String,
    #[builder(default = true)]
    #[serde(default = "default_true")]
    pub http_only: bool,
    #[builder(default = false)]
    #[serde(default)]
    pub secure: bool,
    #[builder(default)]
    #[serde(default)]
    pub same_site: SessionCookieSameSite,
    #[builder(default = Some(StdDuration::from_secs(86_400)))]
    #[serde(default = "default_ttl", with = "humantime_serde::option")]
    pub ttl: Option<StdDuration>,
    #[builder(default = default_post_auth_redirect())]
    #[serde(default = "default_post_auth_redirect")]
    pub post_auth_redirect: RedirectTargetConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSessionContextConfig {
    pub cookie_name: String,
    pub session_context_key: String,
    pub cookie_path: String,
    pub http_only: bool,
    pub secure: bool,
    pub same_site: SessionCookieSameSite,
    pub ttl: Option<StdDuration>,
    pub post_auth_redirect: RedirectTargetConfig,
}

#[derive(Debug, Snafu)]
pub enum SessionContextConfigValidationFailure {
    #[snafu(transparent)]
    Config { source: SessionContextError },
    #[snafu(transparent)]
    Validation {
        source: SessionContextConfigValidationError,
    },
}

pub trait SessionContextConfigSource {
    fn cookie_name_config(&self) -> &str;
    fn session_context_key_config(&self) -> &str;
    fn cookie_path_config(&self) -> &str;
    fn http_only_config(&self) -> bool;
    fn secure_config(&self) -> bool;
    fn same_site_config(&self) -> SessionCookieSameSite;
    fn ttl_config(&self) -> Option<StdDuration>;
    fn post_auth_redirect_config(&self) -> &RedirectTargetConfig;

    fn resolve_cookie_name(&self) -> String {
        self.cookie_name_config().to_string()
    }

    fn resolve_session_context_key(&self) -> String {
        self.session_context_key_config().to_string()
    }

    fn resolve_cookie_path(&self) -> String {
        self.cookie_path_config().to_string()
    }

    fn resolve_http_only(&self) -> bool {
        self.http_only_config()
    }

    fn resolve_secure(&self) -> bool {
        self.secure_config()
    }

    fn resolve_same_site(&self) -> SessionCookieSameSite {
        self.same_site_config()
    }

    fn resolve_ttl(&self) -> Option<StdDuration> {
        self.ttl_config()
    }

    fn resolve_post_auth_redirect_config(&self) -> SessionContextResult<RedirectTargetConfig> {
        let config = self.post_auth_redirect_config().clone();
        resolve_session_post_auth_redirect(&config, None)?;
        Ok(config)
    }

    fn resolve_all(
        &self,
    ) -> Result<ResolvedSessionContextConfig, SessionContextConfigValidationFailure> {
        let validator = NoopSessionContextConfigValidator;
        self.resolve_all_with_validator(&validator)
    }

    fn resolve_all_with_validator<V>(
        &self,
        validator: &V,
    ) -> Result<ResolvedSessionContextConfig, SessionContextConfigValidationFailure>
    where
        V: SessionContextConfigValidator,
    {
        validator
            .validate_session_context_config(self)
            .map_err(|source| SessionContextConfigValidationFailure::Validation { source })?;

        Ok(ResolvedSessionContextConfig {
            cookie_name: self.resolve_cookie_name(),
            session_context_key: self.resolve_session_context_key(),
            cookie_path: self.resolve_cookie_path(),
            http_only: self.resolve_http_only(),
            secure: self.resolve_secure(),
            same_site: self.resolve_same_site(),
            ttl: self.resolve_ttl(),
            post_auth_redirect: self
                .resolve_post_auth_redirect_config()
                .map_err(|source| SessionContextConfigValidationFailure::Config { source })?,
        })
    }
}

impl SessionContextConfigSource for SessionContextConfig {
    fn cookie_name_config(&self) -> &str {
        &self.cookie_name
    }

    fn session_context_key_config(&self) -> &str {
        &self.session_context_key
    }

    fn cookie_path_config(&self) -> &str {
        &self.cookie_path
    }

    fn http_only_config(&self) -> bool {
        self.http_only
    }

    fn secure_config(&self) -> bool {
        self.secure
    }

    fn same_site_config(&self) -> SessionCookieSameSite {
        self.same_site
    }

    fn ttl_config(&self) -> Option<StdDuration> {
        self.ttl
    }

    fn post_auth_redirect_config(&self) -> &RedirectTargetConfig {
        &self.post_auth_redirect
    }
}

impl Default for SessionContextConfig {
    fn default() -> Self {
        Self {
            cookie_name: default_cookie_name(),
            session_context_key: default_session_context_key(),
            cookie_path: default_cookie_path(),
            http_only: default_true(),
            secure: false,
            same_site: SessionCookieSameSite::default(),
            ttl: default_ttl(),
            post_auth_redirect: default_post_auth_redirect(),
        }
    }
}

impl Default for ResolvedSessionContextConfig {
    fn default() -> Self {
        Self {
            cookie_name: default_cookie_name(),
            session_context_key: default_session_context_key(),
            cookie_path: default_cookie_path(),
            http_only: default_true(),
            secure: false,
            same_site: SessionCookieSameSite::default(),
            ttl: default_ttl(),
            post_auth_redirect: default_post_auth_redirect(),
        }
    }
}

impl ResolvedSessionContextConfig {
    pub fn resolve_post_auth_redirect(
        &self,
        requested_post_auth_redirect: Option<&str>,
    ) -> SessionContextResult<String> {
        resolve_session_post_auth_redirect(&self.post_auth_redirect, requested_post_auth_redirect)
    }
}

pub(crate) fn default_cookie_name() -> String {
    crate::DEFAULT_COOKIE_NAME.to_string()
}

pub(crate) fn default_session_context_key() -> String {
    crate::DEFAULT_SESSION_CONTEXT_KEY.to_string()
}

pub(crate) fn default_cookie_path() -> String {
    "/".to_string()
}

pub(crate) fn default_true() -> bool {
    true
}

pub(crate) fn default_ttl() -> Option<StdDuration> {
    Some(StdDuration::from_secs(86_400))
}

pub(crate) fn default_post_auth_redirect() -> RedirectTargetConfig {
    RedirectTargetConfig::strict_default("/")
}

pub(crate) fn resolve_session_post_auth_redirect(
    config: &RedirectTargetConfig,
    requested_post_auth_redirect: Option<&str>,
) -> SessionContextResult<String> {
    UriRelativeRedirectTargetResolver::from_config(config.clone())
        .map_err(|source| SessionContextError::RedirectTarget { source })?
        .resolve_redirect_target(requested_post_auth_redirect)
        .map(|value| value.to_string())
        .map_err(|source| SessionContextError::RedirectTarget { source })
}
