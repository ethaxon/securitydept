use std::{collections::HashMap, future::Future};

use securitydept_oidc_client::{OidcClient, OidcCodeCallbackSearchParams, PendingOauthStore};
use securitydept_utils::{
    http::HttpResponse,
    observability::{
        AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowDiagnosisOutcome, AuthFlowOperation,
        DiagnosedResult,
    },
};
use serde_json::Value;
use tower_sessions::Session;
use url::Url;

use crate::{
    SessionContext, SessionContextConfig, SessionContextError, SessionContextSession,
    SessionPrincipal,
};

/// Errors produced by session auth service operations.
#[derive(Debug, snafu::Snafu)]
pub enum SessionAuthServiceError {
    #[snafu(display("OIDC is disabled"))]
    OidcDisabled,
    #[snafu(transparent)]
    Oidc {
        source: securitydept_oidc_client::OidcError,
    },
    #[snafu(transparent)]
    SessionContext { source: SessionContextError },
}

impl SessionAuthServiceError {
    pub fn status_code(&self) -> http::StatusCode {
        use securitydept_utils::http::ToHttpStatus;
        match self {
            Self::OidcDisabled => http::StatusCode::SERVICE_UNAVAILABLE,
            Self::Oidc { source } => source.to_http_status(),
            Self::SessionContext { source } => source.status_code(),
        }
    }
}

impl securitydept_utils::error::ToErrorPresentation for SessionAuthServiceError {
    fn to_error_presentation(&self) -> securitydept_utils::error::ErrorPresentation {
        #[allow(unused_imports)]
        use securitydept_utils::error::{ErrorPresentation, ToErrorPresentation, UserRecovery};
        match self {
            Self::OidcDisabled => ErrorPresentation::new(
                "oidc_disabled",
                "Authentication is not enabled.",
                UserRecovery::ContactSupport,
            ),
            Self::Oidc { source } => source.to_error_presentation(),
            Self::SessionContext { source } => source.to_error_presentation(),
        }
    }
}

/// Trait for session-based authentication services.
///
/// Provides login, logout, and user_info operations using tower-sessions.
pub trait SessionAuthServiceTrait {
    fn session_context_config(&self) -> &SessionContextConfig;
    fn login_diagnosed(
        &self,
        session: Session,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> impl Future<Output = DiagnosedResult<HttpResponse, SessionAuthServiceError>>;

    fn login(
        &self,
        session: Session,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> impl Future<Output = Result<HttpResponse, SessionAuthServiceError>> {
        async move {
            self.login_diagnosed(session, external_base_url, requested_post_auth_redirect_uri)
                .await
                .into_result()
        }
    }

    fn logout_diagnosed(
        &self,
        session: Session,
    ) -> impl Future<Output = DiagnosedResult<serde_json::Value, SessionAuthServiceError>> {
        let handle = SessionContextSession::from_config(session, self.session_context_config());

        Box::pin(async move {
            let diagnosis = session_logout_diagnosis();
            match handle.flush().await {
                Ok(()) => DiagnosedResult::success(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                        .field("cleared_session", true),
                    serde_json::json!({"ok": true}),
                ),
                Err(source) => DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("cleared_session", false),
                    SessionAuthServiceError::SessionContext { source },
                ),
            }
        })
    }

    fn logout(
        &self,
        session: Session,
    ) -> impl Future<Output = Result<serde_json::Value, SessionAuthServiceError>> {
        async move { self.logout_diagnosed(session).await.into_result() }
    }

    fn user_info_diagnosed(
        &self,
        session: Session,
    ) -> impl Future<
        Output = DiagnosedResult<SessionContext<HashMap<String, Value>>, SessionAuthServiceError>,
    > {
        let handle = SessionContextSession::from_config(session, self.session_context_config());
        Box::pin(async move {
            let diagnosis = session_user_info_diagnosis();
            match handle.require::<HashMap<String, Value>>().await {
                Ok(context) => DiagnosedResult::success(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                        .field("claim_count", context.principal.claims.len())
                        .field("has_picture", context.principal.picture.is_some()),
                    context,
                ),
                Err(source) => {
                    let outcome = match &source {
                        SessionContextError::MissingContext => AuthFlowDiagnosisOutcome::Rejected,
                        _ => AuthFlowDiagnosisOutcome::Failed,
                    };
                    let reason = match &source {
                        SessionContextError::MissingContext => "missing_context",
                        SessionContextError::Session { .. } => "session_error",
                        SessionContextError::RedirectTarget { .. } => "post_auth_redirect_invalid",
                    };
                    DiagnosedResult::failure(
                        diagnosis.with_outcome(outcome).field("reason", reason),
                        SessionAuthServiceError::SessionContext { source },
                    )
                }
            }
        })
    }

    fn user_info(
        &self,
        session: Session,
    ) -> impl Future<Output = Result<SessionContext<HashMap<String, Value>>, SessionAuthServiceError>>
    {
        async move { self.user_info_diagnosed(session).await.into_result() }
    }
}

/// Development session auth service — creates a dev session without OIDC.
pub struct DevSessionAuthService<'a> {
    session_context_config: &'a SessionContextConfig,
}

const PENDING_POST_AUTH_REDIRECT_URI_KEY: &str = "post_auth_redirect_uri";

fn session_login_diagnosis(
    mode: &str,
    requested_post_auth_redirect_uri: Option<&str>,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::SESSION_LOGIN)
        .field(AuthFlowDiagnosisField::AUTH_FAMILY, "session-context")
        .field(AuthFlowDiagnosisField::MODE, mode)
        .field(
            AuthFlowDiagnosisField::HAS_REQUESTED_POST_AUTH_REDIRECT_URI,
            requested_post_auth_redirect_uri.is_some(),
        )
}

fn session_callback_diagnosis(
    external_base_url: &Url,
    search_params: &OidcCodeCallbackSearchParams,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::OIDC_CALLBACK)
        .field(AuthFlowDiagnosisField::AUTH_FAMILY, "session-context")
        .field(AuthFlowDiagnosisField::MODE, "oidc")
        .field(
            AuthFlowDiagnosisField::CALLBACK_PATH,
            "/auth/session/callback",
        )
        .field(
            AuthFlowDiagnosisField::EXTERNAL_BASE_URL,
            external_base_url.as_str(),
        )
        .field(
            AuthFlowDiagnosisField::HAS_STATE,
            search_params.state.is_some(),
        )
        .field(
            AuthFlowDiagnosisField::HAS_CODE,
            !search_params.code.is_empty(),
        )
}

fn session_logout_diagnosis() -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::SESSION_LOGOUT)
        .field(AuthFlowDiagnosisField::AUTH_FAMILY, "session-context")
}

fn session_user_info_diagnosis() -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::SESSION_USER_INFO)
        .field(AuthFlowDiagnosisField::AUTH_FAMILY, "session-context")
}

fn callback_post_auth_redirect_uri(
    result: &securitydept_oidc_client::OidcCodeCallbackResult,
) -> Option<String> {
    result
        .pending_extra_data
        .as_ref()
        .and_then(|value| value.get(PENDING_POST_AUTH_REDIRECT_URI_KEY))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

impl<'a> DevSessionAuthService<'a> {
    pub fn new(
        session_context_config: &'a SessionContextConfig,
    ) -> Result<Self, SessionAuthServiceError> {
        session_context_config
            .resolve_post_auth_redirect(None)
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        Ok(Self {
            session_context_config,
        })
    }
}

impl<'a> SessionAuthServiceTrait for DevSessionAuthService<'a> {
    fn session_context_config(&self) -> &SessionContextConfig {
        self.session_context_config
    }

    async fn login_diagnosed(
        &self,
        session: Session,
        _external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> DiagnosedResult<HttpResponse, SessionAuthServiceError> {
        let diagnosis = session_login_diagnosis("dev", requested_post_auth_redirect_uri)
            .field("oidc_enabled", false);
        let handle = SessionContextSession::from_config(session, self.session_context_config);
        if let Err(source) = handle.cycle_id().await {
            return DiagnosedResult::failure(
                diagnosis
                    .clone()
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field("reason", "cycle_id_failed"),
                SessionAuthServiceError::SessionContext { source },
            );
        }

        let context: SessionContext = SessionContext::builder()
            .principal(
                SessionPrincipal::builder()
                    .subject("dev-session")
                    .display_name("dev")
                    .claims(HashMap::from([(
                        "oidc_enabled".to_string(),
                        Value::Bool(false),
                    )]))
                    .build(),
            )
            .build();
        if let Err(source) = handle.insert(&context).await {
            return DiagnosedResult::failure(
                diagnosis
                    .clone()
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field("reason", "insert_failed"),
                SessionAuthServiceError::SessionContext { source },
            );
        }

        match self
            .session_context_config
            .resolve_post_auth_redirect(requested_post_auth_redirect_uri)
        {
            Ok(redirect_target) => DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field("redirect_target", &redirect_target),
                HttpResponse::found(&redirect_target),
            ),
            Err(source) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field("reason", "post_auth_redirect_invalid"),
                SessionAuthServiceError::SessionContext { source },
            ),
        }
    }

    async fn login(
        &self,
        session: Session,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> Result<HttpResponse, SessionAuthServiceError> {
        self.login_diagnosed(session, external_base_url, requested_post_auth_redirect_uri)
            .await
            .into_result()
    }
}

/// OIDC-based session auth service — delegates to OIDC provider for login.
///
/// Falls back to [`DevSessionAuthService`] when OIDC is disabled.
#[derive(Clone)]
pub struct OidcSessionAuthService<'a, PS>
where
    PS: PendingOauthStore,
{
    oidc_client: Option<&'a OidcClient<PS>>,
    session_context_config: &'a SessionContextConfig,
}

impl<'a, P> OidcSessionAuthService<'a, P>
where
    P: PendingOauthStore,
{
    pub fn new(
        oidc_client: Option<&'a OidcClient<P>>,
        session_context_config: &'a SessionContextConfig,
    ) -> Result<Self, SessionAuthServiceError> {
        session_context_config
            .resolve_post_auth_redirect(None)
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        Ok(Self {
            oidc_client,
            session_context_config,
        })
    }

    pub async fn callback(
        &self,
        session: Session,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
    ) -> Result<HttpResponse, SessionAuthServiceError> {
        self.callback_diagnosed(session, external_base_url, search_params)
            .await
            .into_result()
    }

    pub async fn callback_diagnosed(
        &self,
        session: Session,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
    ) -> DiagnosedResult<HttpResponse, SessionAuthServiceError> {
        let Some(oidc) = self.oidc_client else {
            return DiagnosedResult::failure(
                session_callback_diagnosis(external_base_url, &search_params)
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::REASON, "oidc_disabled"),
                SessionAuthServiceError::OidcDisabled,
            );
        };

        let diagnosed = oidc
            .handle_code_callback_with_redirect_override_diagnosed(
                search_params,
                external_base_url,
                Some("/auth/session/callback"),
            )
            .await;
        let (callback_diagnosis, callback_result) = diagnosed.into_parts();
        let callback_diagnosis = callback_diagnosis
            .field(AuthFlowDiagnosisField::AUTH_FAMILY, "session-context")
            .field(AuthFlowDiagnosisField::MODE, "oidc")
            .field(
                AuthFlowDiagnosisField::CALLBACK_PATH,
                "/auth/session/callback",
            );
        let code_callback_result = match callback_result {
            Ok(result) => result,
            Err(source) => {
                return DiagnosedResult::failure(
                    callback_diagnosis,
                    SessionAuthServiceError::Oidc { source },
                );
            }
        };
        let requested_post_auth_redirect_uri =
            callback_post_auth_redirect_uri(&code_callback_result);
        let claims_check_result = code_callback_result.claims_check_result;
        let subject = code_callback_result.id_token_claims.subject().to_string();
        let issuer = Some(
            code_callback_result
                .id_token_claims
                .issuer()
                .url()
                .to_string(),
        );

        let handle = SessionContextSession::from_config(session, self.session_context_config);
        if let Err(source) = handle.cycle_id().await {
            return DiagnosedResult::failure(
                callback_diagnosis
                    .clone()
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::REASON, "cycle_id_failed")
                    .field(
                        AuthFlowDiagnosisField::POST_AUTH_REDIRECT_PRESENT,
                        requested_post_auth_redirect_uri.is_some(),
                    ),
                SessionAuthServiceError::SessionContext { source },
            );
        }

        let principal = SessionPrincipal {
            subject: subject.clone(),
            display_name: claims_check_result.display_name.clone(),
            picture: claims_check_result.picture,
            issuer,
            claims: claims_check_result.claims,
        };

        let context: SessionContext = SessionContext::builder().principal(principal).build();
        if let Err(source) = handle.insert(&context).await {
            return DiagnosedResult::failure(
                callback_diagnosis
                    .clone()
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::REASON, "insert_failed")
                    .field(AuthFlowDiagnosisField::SUBJECT, subject.clone())
                    .field(
                        AuthFlowDiagnosisField::POST_AUTH_REDIRECT_PRESENT,
                        requested_post_auth_redirect_uri.is_some(),
                    ),
                SessionAuthServiceError::SessionContext { source },
            );
        }
        let redirect_target = self
            .session_context_config
            .resolve_post_auth_redirect(requested_post_auth_redirect_uri.as_deref())
            .map_err(|source| SessionAuthServiceError::SessionContext { source });

        match redirect_target {
            Ok(redirect_target) => DiagnosedResult::success(
                callback_diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field(
                        AuthFlowDiagnosisField::POST_AUTH_REDIRECT_PRESENT,
                        requested_post_auth_redirect_uri.is_some(),
                    )
                    .field(AuthFlowDiagnosisField::SUBJECT, subject),
                HttpResponse::found(&redirect_target),
            ),
            Err(error) => DiagnosedResult::failure(
                callback_diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::REASON, "post_auth_redirect_invalid")
                    .field(
                        AuthFlowDiagnosisField::POST_AUTH_REDIRECT_PRESENT,
                        requested_post_auth_redirect_uri.is_some(),
                    )
                    .field(AuthFlowDiagnosisField::SUBJECT, subject),
                error,
            ),
        }
    }
}

impl<'a, P> SessionAuthServiceTrait for OidcSessionAuthService<'a, P>
where
    P: PendingOauthStore + Sync + Send,
{
    fn session_context_config(&self) -> &SessionContextConfig {
        self.session_context_config
    }

    async fn login_diagnosed(
        &self,
        session: Session,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> DiagnosedResult<HttpResponse, SessionAuthServiceError> {
        if let Some(oidc) = self.oidc_client {
            let diagnosis = session_login_diagnosis("oidc", requested_post_auth_redirect_uri)
                .field("oidc_enabled", true);
            let extra_data = requested_post_auth_redirect_uri.map(|uri| {
                serde_json::json!({
                    PENDING_POST_AUTH_REDIRECT_URI_KEY: uri,
                })
            });
            // Session OIDC callback lives at /auth/session/callback — override
            // the default redirect_url so the IdP returns to the correct path.
            match oidc
                .handle_code_authorize_with_redirect_override_and_extra_data(
                    external_base_url,
                    Some("/auth/session/callback"),
                    extra_data,
                )
                .await
            {
                Ok(authorization_request) => {
                    let authorization_url = authorization_request.authorization_url;
                    DiagnosedResult::success(
                        diagnosis
                            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                            .field("redirect_path", "/auth/session/callback")
                            .field(
                                "authorization_url_host",
                                authorization_url.host_str().unwrap_or("unknown"),
                            ),
                        HttpResponse::temporary_redirect(authorization_url.as_str()),
                    )
                }
                Err(source) => DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("reason", "authorization_request_failed"),
                    SessionAuthServiceError::Oidc { source },
                ),
            }
        } else {
            match DevSessionAuthService::new(self.session_context_config) {
                Ok(service) => {
                    service
                        .login_diagnosed(
                            session,
                            external_base_url,
                            requested_post_auth_redirect_uri,
                        )
                        .await
                }
                Err(error) => DiagnosedResult::failure(
                    session_login_diagnosis("dev", requested_post_auth_redirect_uri)
                        .field("oidc_enabled", false)
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("reason", "dev_service_init_failed"),
                    error,
                ),
            }
        }
    }

    async fn login(
        &self,
        session: Session,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> Result<HttpResponse, SessionAuthServiceError> {
        self.login_diagnosed(session, external_base_url, requested_post_auth_redirect_uri)
            .await
            .into_result()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tower_sessions::Session;
    use tower_sessions_memory_store::MemoryStore;
    use url::Url;

    use super::*;
    use crate::SessionContextConfig;

    /// Minimal in-memory PendingOauthStore for testing without the moka
    /// feature.
    #[derive(Clone)]
    struct TestPendingOauthStore;

    impl securitydept_oidc_client::PendingOauthStore for TestPendingOauthStore {
        type Config = TestPendingOauthStoreConfig;

        fn from_config(_config: &Self::Config) -> Self {
            Self
        }

        async fn insert(
            &self,
            _state: String,
            _nonce: String,
            _code_verifier: Option<String>,
            _extra_data: Option<serde_json::Value>,
        ) -> securitydept_oidc_client::OidcResult<()> {
            Ok(())
        }

        async fn take(
            &self,
            _state: &str,
        ) -> securitydept_oidc_client::OidcResult<Option<securitydept_oidc_client::PendingOauth>>
        {
            Ok(None)
        }
    }

    #[derive(Clone, Default, serde::Deserialize)]
    struct TestPendingOauthStoreConfig;

    impl securitydept_oidc_client::PendingOauthStoreConfig for TestPendingOauthStoreConfig {}

    fn test_session() -> Session {
        let store = Arc::new(MemoryStore::default());
        Session::new(None, store, None)
    }

    fn test_base_url() -> Url {
        Url::parse("https://auth.example.com").unwrap()
    }

    // -----------------------------------------------------------------------
    // DevSessionAuthService
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn dev_login_writes_session_and_redirects() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        let response = service
            .login(session.clone(), &base_url, None)
            .await
            .expect("login should succeed");

        // Should redirect to the configured post_auth_redirect (default: "/").
        assert_eq!(response.status, http::StatusCode::FOUND);

        // Session should now contain the dev principal.
        let handle = SessionContextSession::from_config(session, &config);
        let context = handle
            .get::<HashMap<String, serde_json::Value>>()
            .await
            .expect("session read should succeed")
            .expect("session context should exist after login");

        assert_eq!(context.principal.display_name, "dev");
        assert_eq!(
            context.principal.claims.get("oidc_enabled"),
            Some(&serde_json::Value::Bool(false))
        );
    }

    #[tokio::test]
    async fn dev_login_redirects_to_requested_playground() {
        let config = SessionContextConfig::builder()
            .post_auth_redirect(
                securitydept_utils::redirect::RedirectTargetConfig::dynamic_default_and_dynamic_targets(
                    "/",
                    [securitydept_utils::redirect::RedirectTargetRule::Strict {
                        value: "/playground/session".to_string(),
                    }],
                ),
            )
            .build();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        let response = service
            .login(session, &base_url, Some("/playground/session"))
            .await
            .expect("login should succeed");

        assert_eq!(response.status, http::StatusCode::FOUND);
        assert_eq!(
            response
                .headers
                .get(http::header::LOCATION)
                .map(|s| s.to_str().expect("should convert string").to_string()),
            Some("/playground/session".to_string())
        );
    }

    #[tokio::test]
    async fn dev_login_diagnosed_exposes_machine_readable_fields() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        let diagnosed = service.login_diagnosed(session, &base_url, Some("/")).await;

        assert!(diagnosed.result().is_ok());
        assert_eq!(
            diagnosed.diagnosis().operation,
            AuthFlowOperation::SESSION_LOGIN
        );
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Succeeded
        );
        assert_eq!(
            diagnosed.diagnosis().fields["auth_family"],
            "session-context"
        );
        assert_eq!(diagnosed.diagnosis().fields["mode"], "dev");
        assert_eq!(
            diagnosed.diagnosis().fields
                [AuthFlowDiagnosisField::HAS_REQUESTED_POST_AUTH_REDIRECT_URI],
            true
        );
    }

    #[tokio::test]
    async fn dev_logout_flushes_session() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        // Login first to populate the session.
        service
            .login(session.clone(), &base_url, None)
            .await
            .expect("login should succeed");

        // Verify principal exists before logout.
        let handle = SessionContextSession::from_config(session.clone(), &config);
        assert!(
            handle
                .get::<HashMap<String, serde_json::Value>>()
                .await
                .expect("session read should succeed")
                .is_some(),
            "session context should exist before logout"
        );

        // Logout.
        let result = service.logout(session.clone()).await;
        assert!(result.is_ok(), "logout should succeed");

        // After flush, a fresh read from the same session should find nothing
        // (since flush clears the entire session record from the store).
        let handle_post = SessionContextSession::from_config(session, &config);
        let context_post = handle_post
            .get::<HashMap<String, serde_json::Value>>()
            .await
            .expect("session read should succeed");
        assert!(
            context_post.is_none(),
            "session context should be empty after logout/flush"
        );
    }

    #[tokio::test]
    async fn logout_diagnosed_reports_succeeded_outcome() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        service
            .login(session.clone(), &base_url, None)
            .await
            .expect("login should succeed");

        let diagnosed = service.logout_diagnosed(session).await;

        assert!(diagnosed.result().is_ok());
        assert_eq!(
            diagnosed.diagnosis().operation,
            AuthFlowOperation::SESSION_LOGOUT
        );
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Succeeded
        );
        assert_eq!(diagnosed.diagnosis().fields["cleared_session"], true);
    }

    #[tokio::test]
    async fn dev_me_returns_context_after_login() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        // Before login, user_info() should fail with MissingContext.
        let me_before = service.user_info(session.clone()).await;
        assert!(
            me_before.is_err(),
            "user_info() should fail when no session context exists"
        );

        // Login.
        service
            .login(session.clone(), &base_url, None)
            .await
            .expect("login should succeed");

        // After login, user_info() should return the dev context.
        let context = service
            .user_info(session.clone())
            .await
            .expect("user_info() should succeed after login");

        assert_eq!(context.principal.display_name, "dev");
    }

    #[tokio::test]
    async fn user_info_diagnosed_rejects_missing_context() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();

        let diagnosed = service.user_info_diagnosed(session).await;

        assert!(diagnosed.result().is_err());
        assert_eq!(
            diagnosed.diagnosis().operation,
            AuthFlowOperation::SESSION_USER_INFO
        );
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Rejected
        );
        assert_eq!(diagnosed.diagnosis().fields["reason"], "missing_context");
    }

    #[tokio::test]
    async fn oidc_callback_diagnosed_reports_machine_readable_failure_when_oidc_disabled() {
        let config = SessionContextConfig::default();
        let service = OidcSessionAuthService::<TestPendingOauthStore>::new(None, &config)
            .expect("OidcSessionAuthService should construct");

        let diagnosed = service
            .callback_diagnosed(
                test_session(),
                &test_base_url(),
                OidcCodeCallbackSearchParams {
                    code: "abc".to_string(),
                    state: Some("state-1".to_string()),
                },
            )
            .await;

        assert!(diagnosed.result().is_err());
        assert_eq!(
            diagnosed.diagnosis().operation,
            AuthFlowOperation::OIDC_CALLBACK
        );
        assert_eq!(
            diagnosed.diagnosis().outcome,
            AuthFlowDiagnosisOutcome::Failed
        );
        assert_eq!(
            diagnosed.diagnosis().fields[AuthFlowDiagnosisField::AUTH_FAMILY],
            "session-context"
        );
        assert_eq!(
            diagnosed.diagnosis().fields[AuthFlowDiagnosisField::CALLBACK_PATH],
            "/auth/session/callback"
        );
        assert_eq!(
            diagnosed.diagnosis().fields[AuthFlowDiagnosisField::HAS_STATE],
            true
        );
        assert_eq!(
            diagnosed.diagnosis().fields[AuthFlowDiagnosisField::HAS_CODE],
            true
        );
        assert_eq!(
            diagnosed.diagnosis().fields[AuthFlowDiagnosisField::REASON],
            "oidc_disabled"
        );
    }

    // -----------------------------------------------------------------------
    // OidcSessionAuthService (without OIDC client = dev fallback)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn oidc_service_without_client_falls_back_to_dev() {
        let config = SessionContextConfig::default();
        let service = OidcSessionAuthService::<TestPendingOauthStore>::new(None, &config)
            .expect("OidcSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        let response = service
            .login(session.clone(), &base_url, None)
            .await
            .expect("login should succeed via dev fallback");

        // Should redirect (dev fallback behavior).
        assert_eq!(response.status, http::StatusCode::FOUND);

        // Session should contain the dev principal.
        let context = service
            .user_info(session.clone())
            .await
            .expect("user_info() should succeed after dev-fallback login");
        assert_eq!(context.principal.display_name, "dev");
    }

    #[tokio::test]
    async fn oidc_service_logout_flushes_session() {
        let config = SessionContextConfig::default();
        let service = OidcSessionAuthService::<TestPendingOauthStore>::new(None, &config)
            .expect("OidcSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        // Login first.
        service
            .login(session.clone(), &base_url, None)
            .await
            .expect("login should succeed");

        // Logout.
        let result = service.logout(session.clone()).await;
        assert!(result.is_ok(), "logout should succeed");

        // user_info() should fail after logout.
        let me_after = service.user_info(session.clone()).await;
        assert!(
            me_after.is_err(),
            "user_info() should fail after logout/flush"
        );
    }
}
