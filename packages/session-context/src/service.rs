use std::{collections::HashMap, future::Future};

use securitydept_oidc_client::{OidcClient, OidcCodeCallbackSearchParams, PendingOauthStore};
use securitydept_utils::http::HttpResponse;
use serde_json::Value;
use tower_sessions::Session;
use tracing::info;
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
/// Provides login, logout, and me operations using tower-sessions.
pub trait SessionAuthServiceTrait {
    fn session_context_config(&self) -> &SessionContextConfig;
    fn login(
        &self,
        session: Session,
        external_base_url: &Url,
    ) -> impl Future<Output = Result<HttpResponse, SessionAuthServiceError>>;

    fn logout(
        &self,
        session: Session,
    ) -> impl Future<Output = Result<serde_json::Value, SessionAuthServiceError>> {
        let handle = SessionContextSession::from_config(session, self.session_context_config());

        Box::pin(async move {
            handle
                .flush()
                .await
                .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

            Ok(serde_json::json!({"ok": true}))
        })
    }

    fn me(
        &self,
        session: Session,
    ) -> impl Future<Output = Result<SessionContext<HashMap<String, Value>>, SessionAuthServiceError>>
    {
        let handle = SessionContextSession::from_config(session, self.session_context_config());
        Box::pin(async move {
            let context = handle
                .require::<HashMap<String, Value>>()
                .await
                .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

            Ok(context)
        })
    }
}

/// Development session auth service — creates a dev session without OIDC.
pub struct DevSessionAuthService<'a> {
    session_context_config: &'a SessionContextConfig,
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

    async fn login(
        &self,
        session: Session,
        _external_base_url: &Url,
    ) -> Result<HttpResponse, SessionAuthServiceError> {
        let handle = SessionContextSession::from_config(session, self.session_context_config);
        handle
            .cycle_id()
            .await
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        let context: SessionContext = SessionContext::builder()
            .principal(
                SessionPrincipal::builder()
                    .display_name("dev")
                    .claims(HashMap::from([(
                        "oidc_enabled".to_string(),
                        Value::Bool(false),
                    )]))
                    .build(),
            )
            .build();
        handle
            .insert(&context)
            .await
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        let redirect_target = self
            .session_context_config
            .resolve_post_auth_redirect(None)
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        Ok(HttpResponse::found(&redirect_target))
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
        let oidc = self
            .oidc_client
            .ok_or(SessionAuthServiceError::OidcDisabled)?;

        let code_callback_result = oidc
            .handle_code_callback(search_params, external_base_url)
            .await
            .map_err(|source| SessionAuthServiceError::Oidc { source })?;
        let claims_check_result = code_callback_result.claims_check_result;

        let handle = SessionContextSession::from_config(session, self.session_context_config);
        handle
            .cycle_id()
            .await
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        let principal = SessionPrincipal {
            display_name: claims_check_result.display_name.clone(),
            picture: claims_check_result.picture,
            claims: claims_check_result.claims,
        };

        let context: SessionContext = SessionContext::builder().principal(principal).build();
        handle
            .insert(&context)
            .await
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        info!(display_name = %claims_check_result.display_name, "User logged in");
        let redirect_target = self
            .session_context_config
            .resolve_post_auth_redirect(None)
            .map_err(|source| SessionAuthServiceError::SessionContext { source })?;

        Ok(HttpResponse::found(&redirect_target))
    }
}

impl<'a, P> SessionAuthServiceTrait for OidcSessionAuthService<'a, P>
where
    P: PendingOauthStore + Sync + Send,
{
    fn session_context_config(&self) -> &SessionContextConfig {
        self.session_context_config
    }

    async fn login(
        &self,
        _session: Session,
        external_base_url: &Url,
    ) -> Result<HttpResponse, SessionAuthServiceError> {
        if let Some(oidc) = self.oidc_client {
            let authorization_request = oidc
                .handle_code_authorize(external_base_url)
                .await
                .map_err(|source| SessionAuthServiceError::Oidc { source })?;
            let authorization_url = authorization_request.authorization_url;
            Ok(HttpResponse::temporary_redirect(authorization_url.as_str()))
        } else {
            DevSessionAuthService::new(self.session_context_config)?
                .login(_session, external_base_url)
                .await
        }
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
            .login(session.clone(), &base_url)
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
    async fn dev_logout_flushes_session() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        // Login first to populate the session.
        service
            .login(session.clone(), &base_url)
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
    async fn dev_me_returns_context_after_login() {
        let config = SessionContextConfig::default();
        let service =
            DevSessionAuthService::new(&config).expect("DevSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        // Before login, me() should fail with MissingContext.
        let me_before = service.me(session.clone()).await;
        assert!(
            me_before.is_err(),
            "me() should fail when no session context exists"
        );

        // Login.
        service
            .login(session.clone(), &base_url)
            .await
            .expect("login should succeed");

        // After login, me() should return the dev context.
        let context = service
            .me(session.clone())
            .await
            .expect("me() should succeed after login");

        assert_eq!(context.principal.display_name, "dev");
    }

    // -----------------------------------------------------------------------
    // OidcSessionAuthService (without OIDC client = dev fallback)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn oidc_service_without_client_falls_back_to_dev() {
        let config = SessionContextConfig::default();
        let service = OidcSessionAuthService::<TestPendingOauthStore>::new(
            None,
            &config,
        )
        .expect("OidcSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        let response = service
            .login(session.clone(), &base_url)
            .await
            .expect("login should succeed via dev fallback");

        // Should redirect (dev fallback behavior).
        assert_eq!(response.status, http::StatusCode::FOUND);

        // Session should contain the dev principal.
        let context = service
            .me(session.clone())
            .await
            .expect("me() should succeed after dev-fallback login");
        assert_eq!(context.principal.display_name, "dev");
    }

    #[tokio::test]
    async fn oidc_service_logout_flushes_session() {
        let config = SessionContextConfig::default();
        let service = OidcSessionAuthService::<TestPendingOauthStore>::new(
            None,
            &config,
        )
        .expect("OidcSessionAuthService should construct");
        let session = test_session();
        let base_url = test_base_url();

        // Login first.
        service
            .login(session.clone(), &base_url)
            .await
            .expect("login should succeed");

        // Logout.
        let result = service.logout(session.clone()).await;
        assert!(result.is_ok(), "logout should succeed");

        // me() should fail after logout.
        let me_after = service.me(session.clone()).await;
        assert!(
            me_after.is_err(),
            "me() should fail after logout/flush"
        );
    }
}
