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
