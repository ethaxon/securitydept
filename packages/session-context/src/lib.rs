#[cfg(feature = "service")]
mod service;

use std::{collections::HashMap, time::Duration as StdDuration};

use http::StatusCode;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    redirect::{RedirectTargetConfig, RedirectTargetError, UriRelativeRedirectTargetResolver},
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
#[cfg(feature = "service")]
pub use service::{
    DevSessionAuthService, OidcSessionAuthService, SessionAuthServiceError, SessionAuthServiceTrait,
};
use snafu::Snafu;
use tower_sessions::{
    Expiry, Session, SessionManagerLayer, SessionStore,
    cookie::{SameSite, time::Duration},
};
use typed_builder::TypedBuilder;

pub const DEFAULT_COOKIE_NAME: &str = "securitydept_session";
pub const DEFAULT_SESSION_CONTEXT_KEY: &str = "securitydept.session_context";

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, TypedBuilder)]
pub struct SessionPrincipal {
    #[builder(setter(into))]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub picture: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub claims: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, TypedBuilder)]
pub struct SessionContext<Extra = HashMap<String, Value>> {
    pub principal: SessionPrincipal,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub extra: Option<Extra>,
}

#[derive(Debug, Clone, Copy, Serialize, serde::Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionCookieSameSite {
    Strict,
    #[default]
    Lax,
    None,
}

impl From<SessionCookieSameSite> for SameSite {
    fn from(value: SessionCookieSameSite) -> Self {
        match value {
            SessionCookieSameSite::Strict => SameSite::Strict,
            SessionCookieSameSite::Lax => SameSite::Lax,
            SessionCookieSameSite::None => SameSite::None,
        }
    }
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, TypedBuilder)]
pub struct SessionContextConfig {
    #[builder(default = DEFAULT_COOKIE_NAME.to_string())]
    #[serde(default = "default_cookie_name")]
    pub cookie_name: String,
    #[builder(default = DEFAULT_SESSION_CONTEXT_KEY.to_string())]
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

fn default_cookie_name() -> String {
    DEFAULT_COOKIE_NAME.to_string()
}

fn default_session_context_key() -> String {
    DEFAULT_SESSION_CONTEXT_KEY.to_string()
}

fn default_cookie_path() -> String {
    "/".to_string()
}

fn default_true() -> bool {
    true
}

fn default_ttl() -> Option<StdDuration> {
    Some(StdDuration::from_secs(86_400))
}

fn default_post_auth_redirect() -> RedirectTargetConfig {
    RedirectTargetConfig::strict_default("/")
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

pub fn build_session_layer<Store>(
    config: &SessionContextConfig,
    store: Store,
) -> SessionManagerLayer<Store>
where
    Store: SessionStore,
{
    let mut layer = SessionManagerLayer::new(store)
        .with_name(config.cookie_name.clone())
        .with_path(config.cookie_path.clone())
        .with_same_site(config.same_site.into())
        .with_http_only(config.http_only)
        .with_secure(config.secure);

    if let Some(ttl) = config.ttl {
        layer = layer.with_expiry(Expiry::OnInactivity(
            Duration::seconds(ttl.as_secs() as i64),
        ));
    }

    layer
}

#[derive(Debug, Snafu)]
pub enum SessionContextError {
    #[snafu(display("session context is missing"))]
    MissingContext,
    #[snafu(display("session operation failed: {source}"))]
    Session {
        source: tower_sessions::session::Error,
    },
    #[snafu(display("post-auth redirect is invalid: {source}"))]
    RedirectTarget { source: RedirectTargetError },
}

pub type SessionContextResult<T> = Result<T, SessionContextError>;

impl SessionContextError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::MissingContext => StatusCode::UNAUTHORIZED,
            Self::Session { .. } | Self::RedirectTarget { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ToErrorPresentation for SessionContextError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            SessionContextError::MissingContext => ErrorPresentation::new(
                "authentication_required",
                "Sign in to continue.",
                UserRecovery::Reauthenticate,
            ),
            SessionContextError::Session { .. } => ErrorPresentation::new(
                "session_unavailable",
                "The session is temporarily unavailable.",
                UserRecovery::Retry,
            ),
            SessionContextError::RedirectTarget { .. } => ErrorPresentation::new(
                "session_post_auth_redirect_invalid",
                "The configured post-auth redirect is invalid.",
                UserRecovery::ContactSupport,
            ),
        }
    }
}

impl SessionContextConfig {
    pub fn resolve_post_auth_redirect(
        &self,
        requested_post_auth_redirect: Option<&str>,
    ) -> SessionContextResult<String> {
        UriRelativeRedirectTargetResolver::from_config(self.post_auth_redirect.clone())
            .map_err(|source| SessionContextError::RedirectTarget { source })?
            .resolve_redirect_target(requested_post_auth_redirect)
            .map(|value| value.to_string())
            .map_err(|source| SessionContextError::RedirectTarget { source })
    }
}

#[derive(Clone)]
pub struct SessionContextSession {
    session: Session,
    session_context_key: String,
}

impl From<Session> for SessionContextSession {
    fn from(session: Session) -> Self {
        Self {
            session,
            session_context_key: DEFAULT_SESSION_CONTEXT_KEY.to_string(),
        }
    }
}

impl SessionContextSession {
    pub fn new(session: Session) -> Self {
        Self::from(session)
    }

    pub fn from_config(session: Session, config: &SessionContextConfig) -> Self {
        Self {
            session,
            session_context_key: config.session_context_key.clone(),
        }
    }

    pub fn with_key(session: Session, session_context_key: impl Into<String>) -> Self {
        Self {
            session,
            session_context_key: session_context_key.into(),
        }
    }

    pub fn raw_session(&self) -> &Session {
        &self.session
    }

    pub async fn insert<Extra>(&self, context: &SessionContext<Extra>) -> SessionContextResult<()>
    where
        Extra: Serialize,
    {
        self.session
            .insert(&self.session_context_key, context)
            .await
            .map_err(|source| SessionContextError::Session { source })
    }

    pub async fn get<Extra>(&self) -> SessionContextResult<Option<SessionContext<Extra>>>
    where
        Extra: DeserializeOwned,
    {
        self.session
            .get(&self.session_context_key)
            .await
            .map_err(|source| SessionContextError::Session { source })
    }

    pub async fn require<Extra>(&self) -> SessionContextResult<SessionContext<Extra>>
    where
        Extra: DeserializeOwned,
    {
        self.get().await?.ok_or(SessionContextError::MissingContext)
    }

    pub async fn clear(&self) -> SessionContextResult<()> {
        self.session
            .remove_value(&self.session_context_key)
            .await
            .map(|_| ())
            .map_err(|source| SessionContextError::Session { source })
    }

    pub async fn is_authenticated<Extra>(&self) -> SessionContextResult<bool>
    where
        Extra: DeserializeOwned,
    {
        Ok(self.get::<Extra>().await?.is_some())
    }

    pub async fn cycle_id(&self) -> SessionContextResult<()> {
        self.session
            .cycle_id()
            .await
            .map_err(|source| SessionContextError::Session { source })
    }

    pub async fn flush(&self) -> SessionContextResult<()> {
        self.session
            .flush()
            .await
            .map_err(|source| SessionContextError::Session { source })
    }
}

#[cfg(test)]
mod tests {
    use securitydept_utils::redirect::RedirectTargetRule;

    use super::*;

    #[test]
    fn test_default_config() {
        let config = SessionContextConfig::default();
        assert_eq!(config.cookie_name, DEFAULT_COOKIE_NAME);
        assert_eq!(config.session_context_key, DEFAULT_SESSION_CONTEXT_KEY);
        assert_eq!(config.cookie_path, "/");
        assert!(config.http_only);
        assert!(!config.secure);
        assert_eq!(config.same_site, SessionCookieSameSite::Lax);
        assert_eq!(config.ttl, Some(StdDuration::from_secs(86_400)));
        assert_eq!(
            config.post_auth_redirect.default_redirect_target.as_deref(),
            Some("/")
        );
    }

    #[test]
    fn test_context_with_extra_data() {
        let context = SessionContext::builder()
            .principal(SessionPrincipal::builder().display_name("dev").build())
            .attributes(HashMap::from([(
                "mode".to_string(),
                Value::String("dev".to_string()),
            )]))
            .extra(HashMap::from([(
                "provider".to_string(),
                Value::String("local".to_string()),
            )]))
            .build();

        assert_eq!(context.principal.display_name, "dev");
        assert_eq!(
            context.attributes.get("mode"),
            Some(&Value::String("dev".to_string()))
        );
        assert_eq!(
            context
                .extra
                .as_ref()
                .and_then(|extra| extra.get("provider")),
            Some(&Value::String("local".to_string()))
        );
    }

    #[test]
    fn test_post_auth_redirect_resolution() {
        let config = SessionContextConfig::builder()
            .post_auth_redirect(RedirectTargetConfig::dynamic_default_and_dynamic_targets(
                "/",
                [RedirectTargetRule::Strict {
                    value: "/app".to_string(),
                }],
            ))
            .build();

        assert_eq!(
            config
                .resolve_post_auth_redirect(None)
                .expect("default redirect should resolve"),
            "/"
        );
        assert_eq!(
            config
                .resolve_post_auth_redirect(Some("/app"))
                .expect("dynamic redirect should resolve"),
            "/app"
        );
    }
}
