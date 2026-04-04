use http::StatusCode;
use securitydept_creds::{
    BasicAuthCred, BasicAuthCredsValidator, CredsError, MapBasicAuthCredsValidator,
    parse_basic_auth_header_opt,
};
use securitydept_realip::ResolvedClientIp;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::{HttpResponse, ToHttpStatus},
};
use serde::{Deserialize, Serialize};
use snafu::Snafu;

use crate::{BasicAuthContext, BasicAuthContextError, BasicAuthZone};

/// Errors produced by [`BasicAuthContextService`] operations.
#[derive(Debug, Snafu)]
pub enum BasicAuthContextServiceError {
    #[snafu(transparent)]
    BasicAuthContext { source: BasicAuthContextError },
    #[snafu(transparent)]
    Creds { source: CredsError },
}

impl ToHttpStatus for BasicAuthContextServiceError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            Self::BasicAuthContext { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Creds { source } => source.to_http_status(),
        }
    }
}

impl ToErrorPresentation for BasicAuthContextServiceError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::BasicAuthContext { .. } => ErrorPresentation::new(
                "basic_auth_context_invalid",
                "Basic-auth context is misconfigured.",
                UserRecovery::ContactSupport,
            ),
            Self::Creds { source } => source.to_error_presentation(),
        }
    }
}

/// Route-facing service for basic-auth context operations.
///
/// Provides login, logout, and request authorization based on HTTP Basic
/// credentials.
pub struct BasicAuthContextService<'a, Creds>
where
    Creds: BasicAuthCred + Serialize + for<'de> Deserialize<'de>,
{
    basic_auth_context: &'a BasicAuthContext<Creds>,
}

impl<'a, Creds> BasicAuthContextService<'a, Creds>
where
    Creds: BasicAuthCred + Serialize + for<'de> Deserialize<'de>,
{
    pub fn new(
        basic_auth_context: &'a BasicAuthContext<Creds>,
    ) -> Result<Self, BasicAuthContextServiceError> {
        MapBasicAuthCredsValidator::from_config(&basic_auth_context.creds)
            .map_err(|source| BasicAuthContextServiceError::Creds { source })?;

        Ok(Self { basic_auth_context })
    }

    pub fn context(&self) -> &BasicAuthContext<Creds> {
        self.basic_auth_context
    }

    pub fn login(
        &self,
        request_path: &str,
        authorization_header: Option<&str>,
        requested_post_auth_redirect: Option<&str>,
        resolved_client_ip: Option<&ResolvedClientIp>,
    ) -> Result<HttpResponse, BasicAuthContextServiceError> {
        let Some(zone) = self.basic_auth_context.zone_for_request_path(request_path) else {
            return Ok(HttpResponse::new(StatusCode::NOT_FOUND));
        };

        if !self.real_ip_allowed(resolved_client_ip)? {
            return Ok(HttpResponse::new(StatusCode::FORBIDDEN));
        }

        if self.verify_basic_auth(authorization_header)? {
            zone.login_success_response(requested_post_auth_redirect)
                .map_err(|source| BasicAuthContextServiceError::BasicAuthContext { source })
        } else {
            Ok(zone.login_challenge_response())
        }
    }

    pub fn logout(&self, request_path: &str) -> HttpResponse {
        self.basic_auth_context
            .zone_for_request_path(request_path)
            .map(BasicAuthZone::logout_poison_response)
            .unwrap_or_else(|| HttpResponse::new(StatusCode::NOT_FOUND))
    }

    pub fn authorize_request(
        &self,
        authorization_header: Option<&str>,
        resolved_client_ip: Option<&ResolvedClientIp>,
    ) -> Result<bool, BasicAuthContextServiceError> {
        if !self.real_ip_allowed(resolved_client_ip)? {
            return Ok(false);
        }

        self.verify_basic_auth(authorization_header)
    }

    fn verify_basic_auth(
        &self,
        authorization_header: Option<&str>,
    ) -> Result<bool, BasicAuthContextServiceError> {
        let Some(authorization_header) = authorization_header else {
            return Ok(false);
        };
        let Some((username, password)) = parse_basic_auth_header_opt(authorization_header) else {
            return Ok(false);
        };
        let validator = MapBasicAuthCredsValidator::from_config(&self.basic_auth_context.creds)
            .map_err(|source| BasicAuthContextServiceError::Creds { source })?;

        validator
            .verify_cred(&username, &password)
            .map(|result| result.is_some())
            .map_err(|source| BasicAuthContextServiceError::Creds { source })
    }

    fn real_ip_allowed(
        &self,
        resolved_client_ip: Option<&ResolvedClientIp>,
    ) -> Result<bool, BasicAuthContextServiceError> {
        match (
            self.basic_auth_context.real_ip_access.is_some(),
            resolved_client_ip,
        ) {
            (false, _) => Ok(true),
            (true, None) => Ok(false),
            (true, Some(resolved_client_ip)) => self
                .basic_auth_context
                .ensure_real_ip_allowed(resolved_client_ip)
                .map(|_| true)
                .or_else(|error| match error {
                    BasicAuthContextError::RealIp { .. } => Ok(false),
                    source => Err(BasicAuthContextServiceError::BasicAuthContext { source }),
                }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BasicAuthContext, BasicAuthContextConfig, BasicAuthZoneConfig};

    #[derive(Debug, Clone, Serialize, Deserialize, Default)]
    struct TestCred {
        username: String,
        password: String,
    }

    impl BasicAuthCred for TestCred {
        fn username(&self) -> &str {
            &self.username
        }

        fn verify_password(&self, password: &str) -> securitydept_creds::CredsResult<bool> {
            Ok(password == self.password)
        }
    }

    fn test_context() -> BasicAuthContext<TestCred> {
        BasicAuthContext::from_config(
            BasicAuthContextConfig::builder()
                .creds(securitydept_creds::BasicAuthCredsConfig {
                    users: vec![TestCred {
                        username: "admin".to_string(),
                        password: "secret".to_string(),
                    }],
                })
                .zones(vec![BasicAuthZoneConfig::default()])
                .build(),
        )
        .expect("context should build")
    }

    fn test_context_with_dynamic_redirect() -> BasicAuthContext<TestCred> {
        BasicAuthContext::from_config(
            BasicAuthContextConfig::builder()
                .creds(securitydept_creds::BasicAuthCredsConfig {
                    users: vec![TestCred {
                        username: "admin".to_string(),
                        password: "secret".to_string(),
                    }],
                })
                .zones(vec![BasicAuthZoneConfig::builder()
                    .post_auth_redirect(
                        securitydept_utils::redirect::RedirectTargetConfig::dynamic_default_and_dynamic_targets(
                            "/",
                            [securitydept_utils::redirect::RedirectTargetRule::Strict {
                                value: "/console".to_string(),
                            }],
                        ),
                    )
                    .build()])
                .build(),
        )
        .expect("context should build")
    }

    #[test]
    fn login_without_credentials_returns_challenge() {
        let context = test_context();
        let service = BasicAuthContextService::new(&context).expect("service should build");
        let response = service
            .login("/basic/login", None, None, None)
            .expect("login should return response");

        assert_eq!(response.status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn login_with_valid_credentials_redirects() {
        let context = test_context_with_dynamic_redirect();
        let service = BasicAuthContextService::new(&context).expect("service should build");
        let response = service
            .login(
                "/basic/login",
                Some("Basic YWRtaW46c2VjcmV0"),
                Some("/console"),
                None,
            )
            .expect("login should return response");

        assert_eq!(response.status, StatusCode::FOUND);
        assert_eq!(
            response.headers.get(http::header::LOCATION).unwrap(),
            "/console"
        );
    }
}
