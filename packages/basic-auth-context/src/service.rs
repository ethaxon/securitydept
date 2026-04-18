use http::StatusCode;
use securitydept_creds::{
    BasicAuthCred, BasicAuthCredsValidator, CredsError, MapBasicAuthCredsValidator,
    parse_basic_auth_header_opt,
};
use securitydept_realip::ResolvedClientIp;
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::{HttpResponse, ToHttpStatus},
    observability::{AuthFlowDiagnosis, AuthFlowDiagnosisOutcome, DiagnosedResult},
};
use serde::{Deserialize, Serialize};
use snafu::Snafu;

use crate::{BasicAuthContext, BasicAuthContextError, BasicAuthZone};

const BASIC_AUTH_LOGIN_OPERATION: &str = "basic_auth.login";
const BASIC_AUTH_LOGOUT_OPERATION: &str = "basic_auth.logout";
const BASIC_AUTH_AUTHORIZE_OPERATION: &str = "basic_auth.authorize";

fn basic_auth_diagnosis(operation: &str) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(operation).field("auth_family", "basic-auth")
}

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
        requested_post_auth_redirect_uri: Option<&str>,
        resolved_client_ip: Option<&ResolvedClientIp>,
    ) -> Result<HttpResponse, BasicAuthContextServiceError> {
        self.login_diagnosed(
            request_path,
            authorization_header,
            requested_post_auth_redirect_uri,
            resolved_client_ip,
        )
        .into_result()
    }

    pub fn login_diagnosed(
        &self,
        request_path: &str,
        authorization_header: Option<&str>,
        requested_post_auth_redirect_uri: Option<&str>,
        resolved_client_ip: Option<&ResolvedClientIp>,
    ) -> DiagnosedResult<HttpResponse, BasicAuthContextServiceError> {
        let diagnosis = basic_auth_diagnosis(BASIC_AUTH_LOGIN_OPERATION)
            .field("request_path", request_path)
            .field("authorization_present", authorization_header.is_some())
            .field(
                "has_requested_post_auth_redirect_uri",
                requested_post_auth_redirect_uri.is_some(),
            )
            .field("resolved_client_ip_present", resolved_client_ip.is_some());
        let Some(zone) = self.basic_auth_context.zone_for_request_path(request_path) else {
            return DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field("reason", "zone_not_found")
                    .field("http_status", StatusCode::NOT_FOUND.as_u16()),
                HttpResponse::new(StatusCode::NOT_FOUND),
            );
        };

        let real_ip_allowed = match self.real_ip_allowed(resolved_client_ip) {
            Ok(allowed) => allowed,
            Err(source) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .clone()
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("reason", "real_ip_resolution_failed"),
                    source,
                );
            }
        };
        if !real_ip_allowed {
            return DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field("reason", "real_ip_forbidden")
                    .field("http_status", StatusCode::FORBIDDEN.as_u16()),
                HttpResponse::new(StatusCode::FORBIDDEN),
            );
        }

        let authenticated = match self.verify_basic_auth(authorization_header) {
            Ok(authenticated) => authenticated,
            Err(source) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .clone()
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("reason", "credential_validation_failed"),
                    source,
                );
            }
        };

        if authenticated {
            match zone.login_success_response(requested_post_auth_redirect_uri) {
                Ok(response) => DiagnosedResult::success(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                        .field("authenticated", true)
                        .field("http_status", response.status.as_u16()),
                    response,
                ),
                Err(source) => DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("authenticated", true)
                        .field("reason", "post_auth_redirect_invalid"),
                    BasicAuthContextServiceError::BasicAuthContext { source },
                ),
            }
        } else {
            let response = zone.login_challenge_response();
            DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field("authenticated", false)
                    .field("reason", "challenge_required")
                    .field("http_status", response.status.as_u16()),
                response,
            )
        }
    }

    pub fn logout(&self, request_path: &str) -> HttpResponse {
        self.logout_diagnosed(request_path)
            .into_result()
            .expect("basic-auth logout diagnosis should not fail")
    }

    pub fn logout_diagnosed(
        &self,
        request_path: &str,
    ) -> DiagnosedResult<HttpResponse, BasicAuthContextServiceError> {
        let diagnosis =
            basic_auth_diagnosis(BASIC_AUTH_LOGOUT_OPERATION).field("request_path", request_path);
        if let Some(protocol_response) = self.logout_protocol_response(request_path) {
            let response = protocol_response.into_http_response();
            DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field("response_kind", "logout_poison")
                    .field("http_status", response.status.as_u16()),
                response,
            )
        } else {
            DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field("response_kind", "not_found")
                    .field("http_status", StatusCode::NOT_FOUND.as_u16()),
                HttpResponse::new(StatusCode::NOT_FOUND),
            )
        }
    }

    pub fn logout_protocol_response(
        &self,
        request_path: &str,
    ) -> Option<crate::BasicAuthProtocolResponse> {
        self.basic_auth_context
            .zone_for_request_path(request_path)
            .map(BasicAuthZone::logout_poison_protocol_response)
    }

    pub fn authorize_request(
        &self,
        authorization_header: Option<&str>,
        resolved_client_ip: Option<&ResolvedClientIp>,
    ) -> Result<bool, BasicAuthContextServiceError> {
        self.authorize_request_diagnosed(authorization_header, resolved_client_ip)
            .into_result()
    }

    pub fn authorize_request_diagnosed(
        &self,
        authorization_header: Option<&str>,
        resolved_client_ip: Option<&ResolvedClientIp>,
    ) -> DiagnosedResult<bool, BasicAuthContextServiceError> {
        let diagnosis = basic_auth_diagnosis(BASIC_AUTH_AUTHORIZE_OPERATION)
            .field("authorization_present", authorization_header.is_some())
            .field("resolved_client_ip_present", resolved_client_ip.is_some());

        let real_ip_allowed = match self.real_ip_allowed(resolved_client_ip) {
            Ok(allowed) => allowed,
            Err(source) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .clone()
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("reason", "real_ip_resolution_failed"),
                    source,
                );
            }
        };
        if !real_ip_allowed {
            return DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                    .field("authorized", false)
                    .field("reason", "real_ip_forbidden"),
                false,
            );
        }

        match self.verify_basic_auth(authorization_header) {
            Ok(authorized) => {
                let outcome = if authorized {
                    AuthFlowDiagnosisOutcome::Succeeded
                } else {
                    AuthFlowDiagnosisOutcome::Rejected
                };
                let reason = if authorized {
                    "credentials_verified"
                } else {
                    "credentials_missing_or_invalid"
                };
                DiagnosedResult::success(
                    diagnosis
                        .with_outcome(outcome)
                        .field("authorized", authorized)
                        .field("reason", reason),
                    authorized,
                )
            }
            Err(source) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field("reason", "credential_validation_failed"),
                source,
            ),
        }
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
        let diagnosed = service.login_diagnosed("/basic/login", None, None, None);
        let response = diagnosed
            .result()
            .as_ref()
            .expect("login should return response");

        assert_eq!(response.status, StatusCode::UNAUTHORIZED);
        assert_eq!(diagnosed.diagnosis().operation, BASIC_AUTH_LOGIN_OPERATION);
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Rejected
        );
        assert_eq!(diagnosed.diagnosis().fields["reason"], "challenge_required");
    }

    #[test]
    fn login_with_valid_credentials_redirects() {
        let context = test_context_with_dynamic_redirect();
        let service = BasicAuthContextService::new(&context).expect("service should build");
        let diagnosed = service.login_diagnosed(
            "/basic/login",
            Some("Basic YWRtaW46c2VjcmV0"),
            Some("/console"),
            None,
        );
        let response = diagnosed
            .result()
            .as_ref()
            .expect("login should return response");

        assert_eq!(response.status, StatusCode::FOUND);
        assert_eq!(
            response.headers.get(http::header::LOCATION).unwrap(),
            "/console"
        );
        assert_eq!(diagnosed.diagnosis().operation, BASIC_AUTH_LOGIN_OPERATION);
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Succeeded
        );
        assert_eq!(diagnosed.diagnosis().fields["authenticated"], true);
    }

    #[test]
    fn authorize_request_diagnosed_reports_verified_credentials() {
        let context = test_context();
        let service = BasicAuthContextService::new(&context).expect("service should build");
        let diagnosed = service.authorize_request_diagnosed(Some("Basic YWRtaW46c2VjcmV0"), None);

        assert!(
            diagnosed
                .result()
                .as_ref()
                .is_ok_and(|authorized| *authorized)
        );
        assert_eq!(
            diagnosed.diagnosis().operation,
            BASIC_AUTH_AUTHORIZE_OPERATION
        );
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Succeeded
        );
        assert_eq!(diagnosed.diagnosis().fields["authorized"], true);
    }

    #[test]
    fn logout_diagnosed_reports_logout_poison_protocol_response() {
        let context = test_context();
        let service = BasicAuthContextService::new(&context).expect("service should build");
        let diagnosed = service.logout_diagnosed("/basic/logout");
        let response = diagnosed
            .result()
            .as_ref()
            .expect("logout should produce response");

        assert_eq!(response.status, StatusCode::UNAUTHORIZED);
        assert_eq!(diagnosed.diagnosis().operation, BASIC_AUTH_LOGOUT_OPERATION);
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Succeeded
        );
        assert_eq!(
            diagnosed.diagnosis().fields["response_kind"],
            "logout_poison"
        );
    }
}
