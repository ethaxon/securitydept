use std::sync::Arc;

use http::StatusCode;
use securitydept_creds::{BasicAuthCred, BasicAuthCredsConfig};
use securitydept_realip::{RealIpAccessConfig, RealIpAccessManager, RealIpError, ResolvedClientIp};
use securitydept_utils::{
    http::HttpResponse,
    redirect::{RedirectTargetConfig, RedirectTargetError, UriRelativeRedirectTargetResolver},
};
use serde::{Deserialize, Serialize};
use snafu::Snafu;
use typed_builder::TypedBuilder;
use web_route::WebRoute;

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

fn default_zone_prefix() -> String {
    "/basic".to_string()
}

fn default_login_subpath() -> String {
    "/login".to_string()
}

fn default_logout_subpath() -> String {
    "/logout".to_string()
}

fn default_post_auth_redirect() -> RedirectTargetConfig {
    RedirectTargetConfig::strict_default("/")
}

fn default_realm() -> String {
    "securitydept".to_string()
}

#[derive(Debug, Clone)]
pub struct BasicAuthZone {
    pub zone_prefix: WebRoute,
    pub login_path: WebRoute,
    pub logout_path: WebRoute,
    pub post_auth_redirect: Arc<RedirectTargetConfig>,
    pub realm: String,
    post_auth_redirect_resolver: Arc<UriRelativeRedirectTargetResolver>,
}

#[derive(Debug, Clone)]
pub struct BasicAuthContext<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    pub creds: Arc<BasicAuthCredsConfig<Creds>>,
    pub zones: Vec<BasicAuthZone>,
    pub realm: String,
    pub post_auth_redirect: Arc<RedirectTargetConfig>,
    pub real_ip_access: Option<Arc<RealIpAccessConfig>>,
    post_auth_redirect_resolver: Arc<UriRelativeRedirectTargetResolver>,
    real_ip_access_manager: Option<Arc<RealIpAccessManager>>,
}

#[derive(Debug, Snafu)]
pub enum BasicAuthContextError {
    #[snafu(display("post-auth redirect is invalid: {source}"))]
    RedirectTarget { source: RedirectTargetError },
    #[snafu(display("real-ip access is invalid: {source}"))]
    RealIp { source: RealIpError },
}

pub type BasicAuthContextResult<T> = Result<T, BasicAuthContextError>;

impl<Creds> BasicAuthContextConfig<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    pub fn validate(&self) -> BasicAuthContextResult<()> {
        BasicAuthContext::from_config(self.clone()).map(|_| ())
    }

    pub fn ensure_real_ip_allowed(
        &self,
        resolved_client_ip: &ResolvedClientIp,
    ) -> BasicAuthContextResult<()> {
        BasicAuthContext::from_config(self.clone())?.ensure_real_ip_allowed(resolved_client_ip)
    }
}

impl<Creds> BasicAuthContext<Creds>
where
    Creds: BasicAuthCred + Serialize + for<'a> Deserialize<'a>,
{
    pub fn from_config(config: BasicAuthContextConfig<Creds>) -> BasicAuthContextResult<Self> {
        let post_auth_redirect_resolver = Arc::new(
            UriRelativeRedirectTargetResolver::from_config(config.post_auth_redirect.clone())
                .map_err(|source| BasicAuthContextError::RedirectTarget { source })?,
        );
        let real_ip_access_manager = config
            .real_ip_access
            .clone()
            .map(RealIpAccessManager::from_config)
            .transpose()
            .map_err(|source| BasicAuthContextError::RealIp { source })?
            .map(Arc::new);
        let post_auth_redirect = Arc::new(config.post_auth_redirect.clone());
        let realm = config.realm.unwrap_or_else(default_realm);

        let mut context = Self {
            creds: Arc::new(config.creds),
            zones: Vec::with_capacity(config.zones.len()),
            realm,
            post_auth_redirect,
            real_ip_access: config.real_ip_access.map(Arc::new),
            post_auth_redirect_resolver,
            real_ip_access_manager,
        };

        context.zones = config
            .zones
            .into_iter()
            .map(|zone| BasicAuthZone::from_context_config(zone, &context))
            .collect::<BasicAuthContextResult<Vec<_>>>()?;

        Ok(context)
    }

    pub fn ensure_real_ip_allowed(
        &self,
        resolved_client_ip: &ResolvedClientIp,
    ) -> BasicAuthContextResult<()> {
        if let Some(real_ip_access_manager) = &self.real_ip_access_manager {
            real_ip_access_manager
                .ensure_allowed(resolved_client_ip)
                .map_err(|source| BasicAuthContextError::RealIp { source })?;
        }

        Ok(())
    }

    pub fn resolve_post_auth_redirect(
        &self,
        requested_post_auth_redirect: Option<&str>,
    ) -> BasicAuthContextResult<WebRoute> {
        let redirect_target = self
            .post_auth_redirect_resolver
            .resolve_redirect_target(requested_post_auth_redirect)
            .map_err(|source| BasicAuthContextError::RedirectTarget { source })?;

        Ok(resolve_root_web_route(redirect_target.as_str()))
    }

    pub fn zone_for_request_path(&self, request_path: &str) -> Option<&BasicAuthZone> {
        self.zones
            .iter()
            .find(|zone| zone.is_zone_path(request_path))
    }
}

impl BasicAuthZone {
    pub fn from_isolated_config(config: BasicAuthZoneConfig) -> BasicAuthContextResult<Self> {
        let post_auth_redirect = config
            .post_auth_redirect
            .unwrap_or_else(default_post_auth_redirect);
        let post_auth_redirect_resolver = Arc::new(
            UriRelativeRedirectTargetResolver::from_config(post_auth_redirect.clone())
                .map_err(|source| BasicAuthContextError::RedirectTarget { source })?,
        );

        let zone_prefix = WebRoute::new(config.zone_prefix);

        Ok(Self {
            zone_prefix: zone_prefix.clone(),
            login_path: zone_prefix.join(config.login_subpath),
            logout_path: zone_prefix.join(config.logout_subpath),
            post_auth_redirect: Arc::new(post_auth_redirect),
            realm: config.realm.unwrap_or_else(default_realm),
            post_auth_redirect_resolver,
        })
    }

    pub fn from_context_config(
        config: BasicAuthZoneConfig,
        context: &BasicAuthContext<impl BasicAuthCred + Serialize + for<'a> Deserialize<'a>>,
    ) -> BasicAuthContextResult<Self> {
        let post_auth_redirect_resolver = config
            .post_auth_redirect
            .as_ref()
            .map(|par| UriRelativeRedirectTargetResolver::from_config(par.clone()))
            .transpose()
            .map_err(|source| BasicAuthContextError::RedirectTarget { source })?
            .map(Arc::new)
            .unwrap_or_else(|| context.post_auth_redirect_resolver.clone());
        let post_auth_redirect = config
            .post_auth_redirect
            .map(Arc::new)
            .unwrap_or_else(|| context.post_auth_redirect.clone());

        let zone_prefix = WebRoute::new(config.zone_prefix);

        Ok(Self {
            zone_prefix: zone_prefix.clone(),
            login_path: zone_prefix.join(config.login_subpath),
            logout_path: zone_prefix.join(config.logout_subpath),
            post_auth_redirect,
            realm: config.realm.unwrap_or_else(|| context.realm.clone()),
            post_auth_redirect_resolver,
        })
    }

    /// Returns `WWW-Authenticate` header value for the configured realm.
    pub fn challenge_header_value(&self) -> String {
        format!(r#"Basic realm="{}""#, self.realm)
    }

    /// Returns true when request path is inside configured middleware zone.
    pub fn is_zone_path(&self, request_path: &str) -> bool {
        let zone_prefix = &self.zone_prefix as &str;
        request_path == zone_prefix
            || request_path
                .strip_prefix(zone_prefix)
                .is_some_and(|suffix| suffix.starts_with('/'))
    }

    pub fn is_login_path(&self, request_path: &str) -> bool {
        request_path == &self.login_path as &str
    }

    pub fn is_logout_path(&self, request_path: &str) -> bool {
        request_path == &self.logout_path as &str
    }

    /// Rule for whether a `WWW-Authenticate` challenge header should be
    /// attached.
    ///
    /// Only emit challenge when unauthorized response comes from `login_path`.
    pub fn should_attach_challenge_header(&self, request_path: &str, status: StatusCode) -> bool {
        status == StatusCode::UNAUTHORIZED && self.is_login_path(request_path)
    }

    /// Build the challenge response for login trigger route.
    pub fn login_challenge_response(&self) -> HttpResponse {
        HttpResponse::unauthorized_with_basic_challenge(&self.challenge_header_value())
    }

    /// Build success redirect response for a successful `/basic/login`
    /// authentication.
    pub fn login_success_response(
        &self,
        requested_post_auth_redirect: Option<&str>,
    ) -> Result<HttpResponse, BasicAuthContextError> {
        let redirect_target = self.resolve_post_auth_redirect(requested_post_auth_redirect)?;
        Ok(HttpResponse::found(&redirect_target))
    }

    /// Build logout poisoning response.
    ///
    /// MUST be `401` without `WWW-Authenticate`.
    pub fn logout_poison_response(&self) -> HttpResponse {
        HttpResponse::new(StatusCode::UNAUTHORIZED)
    }

    /// Build unauthorized response for generic handler paths.
    ///
    /// - for `login_path`: 401 with challenge header.
    /// - for all other paths: plain 401 without challenge header.
    pub fn unauthorized_response_for_path(&self, request_path: &str) -> HttpResponse {
        if self.is_login_path(request_path) {
            self.login_challenge_response()
        } else {
            HttpResponse::new(StatusCode::UNAUTHORIZED)
        }
    }

    pub fn resolve_post_auth_redirect(
        &self,
        requested_post_auth_redirect: Option<&str>,
    ) -> Result<WebRoute, BasicAuthContextError> {
        let redirect_target = self
            .post_auth_redirect_resolver
            .resolve_redirect_target(requested_post_auth_redirect)
            .map_err(|source| BasicAuthContextError::RedirectTarget { source })?;

        Ok(resolve_web_route(
            &self.zone_prefix,
            redirect_target.as_str(),
        ))
    }
}

fn resolve_web_route(zone_prefix: &WebRoute, redirect_target: &str) -> WebRoute {
    if redirect_target.starts_with('/') {
        WebRoute::new(redirect_target)
    } else {
        zone_prefix.join(redirect_target)
    }
}

fn resolve_root_web_route(redirect_target: &str) -> WebRoute {
    if redirect_target.starts_with('/') {
        WebRoute::new(redirect_target)
    } else {
        WebRoute::new(format!("/{redirect_target}"))
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use securitydept_realip::ResolvedSourceKind;

    use super::*;

    #[test]
    fn test_default_zone_paths() {
        let zone = BasicAuthZoneConfig::default();

        assert_eq!(zone.zone_prefix, "/basic");
        assert_eq!(zone.login_subpath, "/login");
        assert_eq!(zone.logout_subpath, "/logout");

        assert_eq!(zone.realm, None);
        assert_eq!(zone.post_auth_redirect, None);
    }

    #[test]
    fn test_customizable_paths() {
        let zone_config = BasicAuthZoneConfig::builder()
            .zone_prefix("/internal/basic/".to_string())
            .login_subpath("/signin".to_string())
            .logout_subpath("signout".to_string())
            .post_auth_redirect(RedirectTargetConfig::strict_default("app"))
            .realm("corp".to_string())
            .build();
        let zone = BasicAuthZone::from_isolated_config(zone_config).expect("zone should build");

        assert_eq!(&zone.zone_prefix as &str, "/internal/basic");
        assert_eq!(&zone.login_path as &str, "/internal/basic/signin");
        assert_eq!(&zone.logout_path as &str, "/internal/basic/signout");
        assert_eq!(
            &zone
                .resolve_post_auth_redirect(None)
                .expect("redirect should resolve") as &str,
            "/internal/basic/app"
        );
        assert_eq!(zone.challenge_header_value(), r#"Basic realm="corp""#);
    }

    #[test]
    fn test_dynamic_post_auth_redirect_is_allowed() {
        let zone = BasicAuthZone::from_isolated_config(
            BasicAuthZoneConfig::builder()
                .post_auth_redirect(RedirectTargetConfig::dynamic_default_and_dynamic_targets(
                    "/",
                    [securitydept_utils::redirect::RedirectTargetRule::Strict {
                        value: "/app".to_string(),
                    }],
                ))
                .build(),
        )
        .expect("zone should build");

        assert_eq!(
            &zone
                .resolve_post_auth_redirect(Some("/app"))
                .expect("redirect should resolve") as &str,
            "/app"
        );
    }

    #[test]
    fn test_zone_path_match() {
        let zone = BasicAuthZone::from_isolated_config(BasicAuthZoneConfig::default())
            .expect("zone should build");

        assert!(zone.is_zone_path("/basic"));
        assert!(zone.is_zone_path("/basic/login"));
        assert!(zone.is_zone_path("/basic/any/sub"));
        assert!(!zone.is_zone_path("/api/v1/me"));
        assert!(!zone.is_zone_path("/basically"));
    }

    #[test]
    fn test_should_attach_challenge_header() {
        let zone = BasicAuthZone::from_isolated_config(BasicAuthZoneConfig::default())
            .expect("zone should build");

        assert!(zone.should_attach_challenge_header("/basic/login", StatusCode::UNAUTHORIZED));
        assert!(!zone.should_attach_challenge_header("/api/v1/me", StatusCode::UNAUTHORIZED));
        assert!(!zone.should_attach_challenge_header("/basic/login", StatusCode::FORBIDDEN));
    }

    #[derive(Debug, Clone, Serialize, Deserialize, Default)]
    struct TestCred {
        username: String,
        password_hash: String,
    }

    impl BasicAuthCred for TestCred {
        fn username(&self) -> &str {
            &self.username
        }

        fn verify_password(&self, password: &str) -> securitydept_creds::CredsResult<bool> {
            Ok(password == self.password_hash)
        }
    }

    #[test]
    fn test_basic_auth_context_rejects_invalid_real_ip_access_config() {
        let error = BasicAuthContextConfig::<TestCred>::builder()
            .real_ip_access(RealIpAccessConfig::default())
            .build()
            .validate()
            .expect_err("empty real-ip access config should be rejected");

        assert!(matches!(error, BasicAuthContextError::RealIp { .. }));
    }

    #[test]
    fn test_basic_auth_context_allows_matching_real_ip() {
        let config = BasicAuthContextConfig::<TestCred>::builder()
            .real_ip_access(RealIpAccessConfig {
                allowed_cidrs: vec!["10.0.0.0/8".parse().expect("cidr should parse")],
                allow_fallback: false,
            })
            .build();

        let resolved = ResolvedClientIp {
            client_ip: IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3)),
            peer_ip: IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
            source_name: Some("proxy".to_string()),
            source_kind: ResolvedSourceKind::Header,
            header_name: Some("x-forwarded-for".to_string()),
        };

        config
            .ensure_real_ip_allowed(&resolved)
            .expect("resolved client IP should be allowed");
    }

    #[test]
    fn test_basic_auth_context_builds_zones_with_global_defaults() {
        let context = BasicAuthContextConfig::<TestCred>::builder()
            .realm("corp".to_string())
            .post_auth_redirect(RedirectTargetConfig::strict_default("/console"))
            .zones(vec![
                BasicAuthZoneConfig::builder()
                    .zone_prefix("/internal/basic".to_string())
                    .build(),
            ])
            .build();
        let context = BasicAuthContext::from_config(context).expect("context should build");

        assert_eq!(context.realm, "corp");
        assert_eq!(context.zones.len(), 1);
        assert_eq!(context.zones[0].realm, "corp");
        assert_eq!(
            &context.zones[0]
                .resolve_post_auth_redirect(None)
                .expect("zone redirect should resolve") as &str,
            "/console"
        );
    }

    #[test]
    fn test_basic_auth_context_finds_zone_for_request_path() {
        let context = BasicAuthContext::from_config(
            BasicAuthContextConfig::<TestCred>::builder()
                .zones(vec![
                    BasicAuthZoneConfig::builder()
                        .zone_prefix("/internal/basic".to_string())
                        .build(),
                ])
                .build(),
        )
        .expect("context should build");

        assert!(context.zone_for_request_path("/internal/basic").is_some());
        assert!(
            context
                .zone_for_request_path("/internal/basic/login")
                .is_some()
        );
        assert!(context.zone_for_request_path("/api").is_none());
    }
}
