use axum::{
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use typed_builder::TypedBuilder;
use web_route::WebRoute;

/// Configuration for the browser Basic Auth challenge zone.
///
/// Default values:
/// - middleware prefix: `/basic`
/// - login path: `/basic/login`
/// - logout path: `/basic/logout`
/// - login success redirect path: `/`
/// - realm: `securitydept`
#[derive(Debug, Clone, Serialize, Deserialize, Default, TypedBuilder)]
#[builder(field_defaults(default))]
pub struct BasicAuthZoneConfig {
    #[serde(default = "default_zone_prefix")]
    pub zone_prefix: String,
    #[serde(default = "default_login_subpath")]
    pub login_subpath: String,
    #[serde(default = "default_logout_subpath")]
    pub logout_subpath: String,
    #[serde(default = "default_login_success_redirect_path")]
    pub login_success_redirect_path: String,
    #[serde(default = "default_realm")]
    pub realm: String,
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

fn default_login_success_redirect_path() -> String {
    "/".to_string()
}

fn default_realm() -> String {
    "securitydept".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BasicAuthZone {
    pub zone_prefix: WebRoute,
    pub login_path: WebRoute,
    pub logout_path: WebRoute,
    pub login_success_redirect_path: WebRoute,
    pub realm: String,
}

impl BasicAuthZone {
    pub fn from_config(config: BasicAuthZoneConfig) -> Self {
        let zone_prefix = WebRoute::new(config.zone_prefix);
        Self {
            zone_prefix: zone_prefix.clone(),
            login_path: zone_prefix.join(config.login_subpath),
            logout_path: zone_prefix.join(config.logout_subpath),
            login_success_redirect_path: WebRoute::new(config.login_success_redirect_path),
            realm: config.realm,
        }
    }

    /// Returns `WWW-Authenticate` header value for the configured realm.
    pub fn challenge_header_value(&self) -> String {
        format!(r#"Basic realm=\"{}\""#, self.realm)
    }

    /// Returns true when request path is inside configured middleware zone.
    pub fn is_zone_path(&self, request_path: &str) -> bool {
        request_path.starts_with(&self.zone_prefix as &str)
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
    pub fn login_challenge_response(&self) -> Response {
        let mut headers = HeaderMap::new();
        if let Ok(value) = HeaderValue::from_str(&self.challenge_header_value()) {
            headers.insert("WWW-Authenticate", value);
        }
        (StatusCode::UNAUTHORIZED, headers).into_response()
    }

    /// Build success redirect response for a successful `/basic/login`
    /// authentication.
    pub fn login_success_response(&self) -> Response {
        let mut headers = HeaderMap::new();
        if let Ok(value) = HeaderValue::from_str(&self.login_success_redirect_path) {
            headers.insert("Location", value);
        }
        (StatusCode::FOUND, headers).into_response()
    }

    /// Build logout poisoning response.
    ///
    /// MUST be `401` without `WWW-Authenticate`.
    pub fn logout_poison_response(&self) -> Response {
        StatusCode::UNAUTHORIZED.into_response()
    }

    /// Build unauthorized response for generic handler paths.
    ///
    /// - for `login_path`: 401 with challenge header.
    /// - for all other paths: plain 401 without challenge header.
    pub fn unauthorized_response_for_path(&self, request_path: &str) -> Response {
        if self.is_login_path(request_path) {
            self.login_challenge_response()
        } else {
            StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_zone_paths() {
        let zone = BasicAuthZoneConfig::default();
        assert_eq!(zone.zone_prefix, "/basic");
        assert_eq!(zone.login_subpath, "/login");
        assert_eq!(zone.logout_subpath, "/logout");
        assert_eq!(zone.login_success_redirect_path, "/");
        assert_eq!(zone.realm, "securitydept");
    }

    #[test]
    fn test_customizable_paths() {
        let zone_config = BasicAuthZoneConfig::builder()
            .zone_prefix("/internal/basic/".to_string())
            .login_subpath("/signin".to_string())
            .logout_subpath("signout".to_string())
            .login_success_redirect_path("app".to_string())
            .realm("corp".to_string())
            .build();
        let zone = BasicAuthZone::from_config(zone_config);

        assert_eq!(&zone.zone_prefix as &str, "/internal/basic");
        assert_eq!(&zone.login_path as &str, "/internal/basic/signin");
        assert_eq!(&zone.logout_path as &str, "/internal/basic/signout");
        assert_eq!(
            &zone.login_success_redirect_path as &str,
            "/internal/basic/app"
        );
        assert_eq!(zone.challenge_header_value(), r#"Basic realm=\"corp\""#);
    }

    #[test]
    fn test_zone_path_match() {
        let zone_config = BasicAuthZoneConfig::default();
        let zone = BasicAuthZone::from_config(zone_config);

        assert!(zone.is_zone_path("/basic"));
        assert!(zone.is_zone_path("/basic/login"));
        assert!(zone.is_zone_path("/basic/any/sub"));
        assert!(!zone.is_zone_path("/api/v1/me"));
        assert!(!zone.is_zone_path("/basically"));
    }

    #[test]
    fn test_should_attach_challenge_header() {
        let zone_config = BasicAuthZoneConfig::default();
        let zone = BasicAuthZone::from_config(zone_config);

        assert!(zone.should_attach_challenge_header("/basic/login", StatusCode::UNAUTHORIZED));
        assert!(!zone.should_attach_challenge_header("/api/v1/me", StatusCode::UNAUTHORIZED));
        assert!(!zone.should_attach_challenge_header("/basic/login", StatusCode::FORBIDDEN));
    }
}
