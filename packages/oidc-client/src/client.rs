use std::{borrow::Cow, cmp::min, sync::Arc, time::Duration};

use base64::Engine;
use chrono::Utc;
use openidconnect::{
    AccessToken, AuthType, AuthenticationFlow, AuthorizationCode, Client, ClientId, ClientSecret,
    CsrfToken, DeviceAuthorizationUrl, DeviceCodeErrorResponse, DeviceCodeErrorResponseType,
    EndpointMaybeSet, EndpointNotSet, EndpointSet, IntrospectionUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, RefreshToken, RevocationUrl, Scope,
    StandardErrorResponse, StandardTokenResponse, SubjectIdentifier, TokenResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreClientAuthMethod, CoreDeviceAuthorizationResponse,
        CoreErrorResponseType, CoreGenderClaim, CoreJsonWebKey, CoreJweContentEncryptionAlgorithm,
        CoreJwsSigningAlgorithm, CoreRevocableToken, CoreRevocationErrorResponse,
        CoreTokenIntrospectionResponse, CoreTokenType,
    },
    reqwest,
};
use securitydept_oauth_provider::{OAuthProviderRuntime, ProviderMetadataWithExtra};
use securitydept_utils::observability::{
    AuthFlowDiagnosis, AuthFlowDiagnosisOutcome, DiagnosedResult,
};
use url::Url;

#[cfg(not(feature = "claims-script"))]
use crate::claims::DefaultClaimsChecker;
#[cfg(feature = "claims-script")]
use crate::claims::ScriptClaimsChecker;
use crate::{
    ClaimsCheckResult, ExtraOidcClaims, IdTokenClaimsWithExtra, OidcCodeCallbackSearchParams,
    OidcCodeExchangeResult, OidcCodeFlowAuthorizationRequest, OidcDeviceAuthorizationResult,
    OidcDeviceTokenPollResult, OidcDeviceTokenResult, OidcRevocableToken, PendingOauthStore,
    PendingOauthStoreConfig, UserInfoClaimsWithExtra, UserInfoExchangeResult,
    claims::ClaimsChecker,
    config::OidcClientConfig,
    error::{OidcError, OidcResult},
    models::{IdTokenFieldsWithExtra, OidcCodeCallbackResult, OidcRefreshTokenResult},
};

pub type TokenResponseWithExtra = StandardTokenResponse<IdTokenFieldsWithExtra, CoreTokenType>;

pub type ClientWithExtra<
    HasAuthUrl = EndpointNotSet,
    HasDeviceAuthUrl = EndpointNotSet,
    HasIntrospectionUrl = EndpointNotSet,
    HasRevocationUrl = EndpointNotSet,
    HasTokenUrl = EndpointNotSet,
    HasUserInfoUrl = EndpointNotSet,
> = Client<
    ExtraOidcClaims,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    TokenResponseWithExtra,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    HasAuthUrl,
    HasDeviceAuthUrl,
    HasIntrospectionUrl,
    HasRevocationUrl,
    HasTokenUrl,
    HasUserInfoUrl,
>;

pub type DiscoveredClientWithExtra = ClientWithExtra<
    EndpointSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// Wraps the OIDC discovered client for login/callback flows.
///
/// The redirect URI is resolved dynamically per-request so that
/// `external_base_url = "auto"` can produce the correct absolute callback URL
/// based on the incoming request headers.
pub struct OidcClient<PS>
where
    PS: PendingOauthStore,
{
    config: OidcClientConfig<PS::Config>,
    provider: Arc<OAuthProviderRuntime>,
    base_client: DiscoveredClientWithExtra,
    #[cfg(feature = "claims-script")]
    claims_checker: ScriptClaimsChecker,
    #[cfg(not(feature = "claims-script"))]
    claims_checker: DefaultClaimsChecker,
    scopes: Vec<String>,
    pkce_enabled: bool,
    pending_oauth_store: PS,
}

impl<PS> OidcClient<PS>
where
    PS: PendingOauthStore,
{
    pub async fn from_config(config: OidcClientConfig<PS::Config>) -> OidcResult<Self> {
        config.validate()?;
        let provider = Arc::new(OAuthProviderRuntime::from_config(config.provider_config()).await?);
        Self::from_provider(provider, config).await
    }

    pub async fn from_provider(
        provider: Arc<OAuthProviderRuntime>,
        config: OidcClientConfig<PS::Config>,
    ) -> OidcResult<Self> {
        config.validate()?;

        let base_client =
            build_client(&config, provider.oidc_provider_metadata().await?).map_err(|e| {
                OidcError::Metadata {
                    message: format!("Failed to build OIDC client from provider metadata: {e}"),
                }
            })?;

        #[cfg(feature = "claims-script")]
        let claims_checker =
            ScriptClaimsChecker::from_file(config.claims_check_script.as_deref()).await?;
        #[cfg(not(feature = "claims-script"))]
        let claims_checker = DefaultClaimsChecker;

        Ok(Self {
            pending_oauth_store: PS::from_config_opt(config.pending_store.as_ref()),
            config,
            provider,
            base_client,
            claims_checker,
            scopes: vec![],
            pkce_enabled: false,
        }
        .with_runtime_flags())
    }

    pub fn provider(&self) -> &Arc<OAuthProviderRuntime> {
        &self.provider
    }

    pub async fn handle_code_authorize(
        &self,
        external_base_url: &Url,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        self.handle_code_authorize_with_redirect_override(external_base_url, None)
            .await
    }

    pub async fn handle_code_authorize_with_redirect_override(
        &self,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        self.handle_code_authorize_with_redirect_override_and_extra_data(
            external_base_url,
            redirect_url_override,
            None,
        )
        .await
    }

    pub async fn handle_code_authorize_with_redirect_override_and_extra_data(
        &self,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
        extra_data: Option<serde_json::Value>,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        let authorization_request =
            self.authorize_url_with_redirect_override(external_base_url, redirect_url_override)?;
        self.pending_oauth_store
            .insert(
                authorization_request.csrf_token.secret().to_string(),
                authorization_request.nonce.secret().to_string(),
                authorization_request.pkce_verifier_secret.clone(),
                extra_data,
            )
            .await?;
        Ok(authorization_request)
    }

    pub async fn handle_device_authorize(&self) -> OidcResult<OidcDeviceAuthorizationResult> {
        let client = self.fresh_client().await?;
        let mut request =
            client
                .exchange_device_code()
                .map_err(|e| OidcError::DeviceAuthorization {
                    message: format!("Device authorization endpoint not set or config error: {e}"),
                })?;

        for scope in &self.scopes {
            request = request.add_scope(Scope::new(scope.clone()));
        }

        let details: CoreDeviceAuthorizationResponse = request
            .request_async(self.provider.http_client())
            .await
            .map_err(|e| OidcError::DeviceAuthorization {
                message: format!("Device authorization request failed: {e}"),
            })?;

        Ok(OidcDeviceAuthorizationResult {
            device_code: details.device_code().secret().to_string(),
            user_code: details.user_code().secret().to_string(),
            verification_uri: details.verification_uri().to_string(),
            verification_uri_complete: details
                .verification_uri_complete()
                .map(|value| value.secret().to_string()),
            expires_in: details.expires_in(),
            interval: Some(details.interval()),
        })
    }

    pub async fn handle_device_token_poll(
        &self,
        device_authorization: &OidcDeviceAuthorizationResult,
        current_interval: Option<Duration>,
    ) -> OidcResult<OidcDeviceTokenPollResult> {
        let current_interval = current_interval.unwrap_or_else(|| {
            device_authorization.poll_interval(self.config.device_poll_interval)
        });

        match self.request_device_token_once(device_authorization).await? {
            DeviceTokenPollResponse::Complete(token_response) => {
                let token_result = self.build_device_token_result(*token_response).await?;
                Ok(OidcDeviceTokenPollResult::Complete {
                    token_result: Box::new(token_result),
                })
            }
            DeviceTokenPollResponse::Pending => Ok(OidcDeviceTokenPollResult::Pending {
                interval: current_interval,
            }),
            DeviceTokenPollResponse::SlowDown => Ok(OidcDeviceTokenPollResult::SlowDown {
                interval: current_interval.saturating_add(Duration::from_secs(5)),
            }),
            DeviceTokenPollResponse::Denied { error_description } => {
                Ok(OidcDeviceTokenPollResult::Denied { error_description })
            }
            DeviceTokenPollResponse::Expired { error_description } => {
                Ok(OidcDeviceTokenPollResult::Expired { error_description })
            }
        }
    }

    pub async fn handle_device_token_poll_until_complete(
        &self,
        device_authorization: &OidcDeviceAuthorizationResult,
        timeout: Option<Duration>,
    ) -> OidcResult<OidcDeviceTokenResult> {
        let started_at = std::time::Instant::now();
        let mut interval = device_authorization.poll_interval(self.config.device_poll_interval);

        // Enforce a minimum interval of 1 second to prevent busy-polling
        // when the server returns interval=0.
        const MIN_POLL_INTERVAL: Duration = Duration::from_secs(1);

        loop {
            if let Some(timeout) = timeout {
                let elapsed = started_at.elapsed();
                if elapsed >= timeout {
                    return Err(OidcError::DeviceTokenPoll {
                        message: format!(
                            "Device token polling timed out after {} seconds",
                            timeout.as_secs()
                        ),
                    });
                }
            }

            match self
                .handle_device_token_poll(device_authorization, Some(interval))
                .await?
            {
                OidcDeviceTokenPollResult::Complete { token_result } => return Ok(*token_result),
                OidcDeviceTokenPollResult::Pending {
                    interval: next_interval,
                }
                | OidcDeviceTokenPollResult::SlowDown {
                    interval: next_interval,
                } => {
                    interval = next_interval.max(MIN_POLL_INTERVAL);
                    let sleep_duration = if let Some(timeout) = timeout {
                        let remaining = timeout.saturating_sub(started_at.elapsed());
                        min(interval, remaining)
                    } else {
                        interval
                    };
                    tokio::time::sleep(sleep_duration).await;
                }
                OidcDeviceTokenPollResult::Denied { error_description } => {
                    return Err(OidcError::DeviceTokenPoll {
                        message: format_device_token_terminal_message(
                            "access_denied",
                            error_description.as_deref(),
                        ),
                    });
                }
                OidcDeviceTokenPollResult::Expired { error_description } => {
                    return Err(OidcError::DeviceTokenPoll {
                        message: format_device_token_terminal_message(
                            "expired_token",
                            error_description.as_deref(),
                        ),
                    });
                }
            }
        }
    }

    pub async fn handle_code_callback(
        &self,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
    ) -> OidcResult<OidcCodeCallbackResult> {
        self.handle_code_callback_with_redirect_override_diagnosed(
            search_params,
            external_base_url,
            None,
        )
        .await
        .into_result()
    }

    pub async fn handle_code_callback_with_redirect_override(
        &self,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
    ) -> OidcResult<OidcCodeCallbackResult> {
        self.handle_code_callback_with_redirect_override_diagnosed(
            search_params,
            external_base_url,
            redirect_url_override,
        )
        .await
        .into_result()
    }

    pub async fn handle_code_callback_with_redirect_override_diagnosed(
        &self,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
    ) -> DiagnosedResult<OidcCodeCallbackResult, OidcError> {
        let diagnosis = AuthFlowDiagnosis::started("oidc.callback")
            .field("redirect_override", redirect_url_override)
            .field("external_base_url", external_base_url.as_str())
            .field("pkce_enabled", self.pkce_enabled)
            .field("has_state", search_params.state.is_some())
            .field("has_code", !search_params.code.is_empty());

        let code = &search_params.code;
        let state = search_params
            .state
            .as_ref()
            .ok_or_else(|| OidcError::CSRFValidation {
                message: "Missing state parameter in callback (required for CSRF validation)"
                    .to_string(),
            });

        let state = match state {
            Ok(state) => state,
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                        .field("failure_stage", "csrf_validation"),
                    error,
                );
            }
        };

        let pending = match self.pending_oauth_store.take(state).await {
            Ok(pending) => pending.ok_or_else(|| OidcError::PendingOauth {
                source: "Invalid or expired state (reuse or unknown); try logging in again"
                    .to_string()
                    .into(),
            }),
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("failure_stage", "pending_oauth_store"),
                    error,
                );
            }
        };

        let pending = match pending {
            Ok(pending) => pending,
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
                        .field("failure_stage", "pending_oauth_state"),
                    error,
                );
            }
        };

        let nonce = openidconnect::Nonce::new(pending.nonce.clone());
        let code_verifier = pending.code_verifier;

        let code_exchange = self
            .exchange_code_with_redirect_override(
                external_base_url,
                code,
                &nonce,
                code_verifier.as_deref(),
                redirect_url_override,
            )
            .await;

        let code_exchange = match code_exchange {
            Ok(code_exchange) => code_exchange,
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("failure_stage", "token_exchange"),
                    error,
                );
            }
        };

        let claims_check_result = self
            .check_claims(
                &code_exchange.id_token_claims,
                code_exchange.user_info_claims.as_ref(),
            )
            .await;

        let claims_check_result = match claims_check_result {
            Ok(claims_check_result) => claims_check_result,
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("failure_stage", "claims_check"),
                    error,
                );
            }
        };

        let result = OidcCodeCallbackResult {
            code: search_params.code,
            pkce_verifier_secret: code_verifier,
            state: search_params.state,
            nonce: pending.nonce,
            pending_extra_data: pending.extra_data,
            access_token: code_exchange.access_token,
            access_token_expiration: code_exchange.access_token_expiration,
            id_token: code_exchange.id_token,
            refresh_token: code_exchange.refresh_token,
            id_token_claims: code_exchange.id_token_claims,
            user_info_claims: code_exchange.user_info_claims,
            claims_check_result,
        };

        DiagnosedResult::success(
            diagnosis
                .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                .field("subject", result.id_token_claims.subject().to_string())
                .field("has_refresh_token", result.refresh_token.is_some())
                .field("has_user_info_claims", result.user_info_claims.is_some()),
            result,
        )
    }

    pub async fn handle_token_refresh(
        &self,
        refresh_token: String,
        // optional previous id_token to prevent not return new id_token
        id_token: Option<String>,
    ) -> OidcResult<OidcRefreshTokenResult> {
        self.handle_token_refresh_diagnosed(refresh_token, id_token)
            .await
            .into_result()
    }

    pub async fn handle_token_refresh_diagnosed(
        &self,
        refresh_token: String,
        id_token: Option<String>,
    ) -> DiagnosedResult<OidcRefreshTokenResult, OidcError> {
        let diagnosis = AuthFlowDiagnosis::started("oidc.token_refresh")
            .field("has_previous_id_token", id_token.is_some())
            .field("pkce_enabled", self.pkce_enabled);

        let client = match self.fresh_client().await {
            Ok(client) => client,
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("failure_stage", "client_metadata_refresh"),
                    error,
                );
            }
        };
        let refresh_token = RefreshToken::new(refresh_token);
        let now = Utc::now();

        let token_request =
            client
                .exchange_refresh_token(&refresh_token)
                .map_err(|e| OidcError::TokenRefresh {
                    message: format!("Token endpoint not set or config error: {e}"),
                });

        let token_request = match token_request {
            Ok(token_request) => token_request,
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("failure_stage", "token_refresh_request_build"),
                    error,
                );
            }
        };

        let token_response = token_request
            .request_async(self.provider.http_client())
            .await
            .map_err(|e| OidcError::TokenRefresh {
                message: format!("Refresh token request failed: {e}"),
            });

        let token_response = match token_response {
            Ok(token_response) => token_response,
            Err(error) => {
                return DiagnosedResult::failure(
                    diagnosis
                        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                        .field("failure_stage", "token_refresh"),
                    error,
                );
            }
        };

        let access_token = token_response.access_token().secret().clone();
        let access_token_expiration = token_response
            .expires_in()
            .map(|expires_in| now + expires_in);
        let refresh_token = token_response
            .refresh_token()
            .map(|value| value.secret().clone());
        let id_token = token_response
            .id_token()
            .map(|value| value.to_string())
            .or(id_token);

        let mut result = OidcRefreshTokenResult {
            access_token,
            access_token_expiration,
            refresh_token,
            id_token,
            user_info_claims: None,
            claims_check_result: None,
            id_token_claims: None,
        };

        // Validate required scopes after successful refresh.
        if let Err(error) = self.check_required_scopes(token_response.scopes()) {
            return DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field("failure_stage", "scope_validation"),
                error,
            );
        }

        if let Some(next_id_token) = token_response.extra_fields().id_token() {
            let id_token_verifier = client.id_token_verifier();
            let id_token_claims = next_id_token
                .claims(&id_token_verifier, |_nonce: Option<&Nonce>| Ok(()))
                .map_err(|e| OidcError::TokenRefresh {
                    message: format!("Failed to verify refreshed ID token: {e}"),
                });
            let id_token_claims = match id_token_claims {
                Ok(id_token_claims) => id_token_claims,
                Err(error) => {
                    return DiagnosedResult::failure(
                        diagnosis
                            .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                            .field("failure_stage", "id_token_verification"),
                        error,
                    );
                }
            };
            let user_info_claims = if client.user_info_url().is_some() {
                match self
                    .request_userinfo(
                        &client,
                        self.provider.http_client(),
                        token_response.access_token().clone(),
                        Some(id_token_claims.subject().clone()),
                    )
                    .await
                {
                    Ok(user_info_claims) => Some(user_info_claims),
                    Err(error) => {
                        return DiagnosedResult::failure(
                            diagnosis
                                .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                                .field("failure_stage", "userinfo_exchange"),
                            error,
                        );
                    }
                }
            } else {
                None
            };
            let claims_check_result = self
                .check_claims(id_token_claims, user_info_claims.as_ref())
                .await;
            let claims_check_result = match claims_check_result {
                Ok(claims_check_result) => claims_check_result,
                Err(error) => {
                    return DiagnosedResult::failure(
                        diagnosis
                            .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                            .field("failure_stage", "claims_check"),
                        error,
                    );
                }
            };
            result.id_token = Some(next_id_token.to_string());
            result.id_token_claims = Some(id_token_claims.clone());
            result.user_info_claims = user_info_claims;
            result.claims_check_result = Some(claims_check_result);
        }

        DiagnosedResult::success(
            diagnosis
                .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                .field("has_refresh_token", result.refresh_token.is_some())
                .field("has_new_id_token", result.id_token.is_some())
                .field(
                    "has_claims_check_result",
                    result.claims_check_result.is_some(),
                ),
            result,
        )
    }

    pub async fn handle_token_revoke(&self, token: OidcRevocableToken) -> OidcResult<()> {
        let client = self.fresh_client().await?;
        let token: CoreRevocableToken = match token {
            OidcRevocableToken::AccessToken(token) => AccessToken::new(token).into(),
            OidcRevocableToken::RefreshToken(token) => RefreshToken::new(token).into(),
        };

        client
            .revoke_token(token)
            .map_err(|e| OidcError::TokenRevocation {
                message: format!("Revocation endpoint not set or config error: {e}"),
            })?
            .request_async(self.provider.http_client())
            .await
            .map_err(|e| OidcError::TokenRevocation {
                message: format!("Token revocation request failed: {e}"),
            })
    }

    /// Shared `user_info` exchange helper for backend modes.
    ///
    /// Given a raw `id_token` string and a bearer `access_token`, this method:
    ///
    /// 1. Decodes and verifies the ID token (nonce validation is skipped, since
    ///    this is a server-side post-flow call, not an in-flight callback).
    /// 2. Optionally calls the provider's userinfo endpoint (if available).
    /// 3. Runs `check_claims` to produce a `ClaimsCheckResult`.
    ///
    /// Backend OIDC presets (pure, mediated, etc.) should call
    /// this helper rather than reimplementing the user-info protocol stack.
    pub async fn handle_user_info_exchange(
        &self,
        id_token_raw: &str,
        access_token: &str,
    ) -> OidcResult<UserInfoExchangeResult> {
        let client = self.fresh_client().await?;
        let id_token_verifier = client.id_token_verifier();

        // Parse the raw ID token string into the typed token via serde.
        let id_token: openidconnect::IdToken<
            ExtraOidcClaims,
            CoreGenderClaim,
            CoreJweContentEncryptionAlgorithm,
            CoreJwsSigningAlgorithm,
        > = serde_json::from_value(serde_json::Value::String(id_token_raw.to_string())).map_err(
            |e| OidcError::Claims {
                message: format!("Failed to parse ID token string in user_info exchange: {e}"),
            },
        )?;

        // Verify and decode — skip nonce for server-side post-flow calls.
        let id_token_claims = id_token
            .claims(&id_token_verifier, |_nonce: Option<&Nonce>| Ok(()))
            .map_err(|e| OidcError::Claims {
                message: format!("Failed to verify ID token in user_info exchange: {e}"),
            })?;

        let access_token_obj = AccessToken::new(access_token.to_string());

        let user_info_claims = if client.user_info_url().is_some() {
            Some(
                self.request_userinfo(
                    &client,
                    self.provider.http_client(),
                    access_token_obj,
                    Some(id_token_claims.subject().clone()),
                )
                .await?,
            )
        } else {
            None
        };

        let claims_check_result = self
            .check_claims(id_token_claims, user_info_claims.as_ref())
            .await?;

        let issuer = id_token_claims.issuer().url().to_string();

        Ok(UserInfoExchangeResult {
            subject: id_token_claims.subject().to_string(),
            display_name: claims_check_result.display_name,
            picture: claims_check_result.picture,
            issuer: Some(issuer),
            claims: Some(claims_check_result.claims),
        })
    }

    async fn request_userinfo(
        &self,
        client: &DiscoveredClientWithExtra,
        http_client: &reqwest::Client,
        access_token: openidconnect::AccessToken,
        expected_subject: Option<SubjectIdentifier>,
    ) -> OidcResult<UserInfoClaimsWithExtra> {
        client
            .user_info(access_token, expected_subject)
            .map_err(|e| OidcError::Claims {
                message: format!("UserInfo request configuration failed: {e}"),
            })?
            .request_async(http_client)
            .await
            .map_err(|e| OidcError::Claims {
                message: format!("UserInfo request failed: {e}"),
            })
    }

    async fn check_claims(
        &self,
        id_token_claims: &IdTokenClaimsWithExtra,
        user_info_claims: Option<&UserInfoClaimsWithExtra>,
    ) -> OidcResult<ClaimsCheckResult> {
        self.claims_checker
            .check_claims(id_token_claims, user_info_claims)
            .await
    }

    fn resolve_redirect_url(
        &self,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
    ) -> OidcResult<Url> {
        external_base_url
            .join(redirect_url_override.unwrap_or(&self.config.redirect_url))
            .map_err(|e| OidcError::RedirectUrl { source: e })
    }

    fn client_with_redirect_override(
        &self,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
    ) -> OidcResult<DiscoveredClientWithExtra> {
        let redirect_url = self.resolve_redirect_url(external_base_url, redirect_url_override)?;
        Ok(self
            .base_client
            .clone()
            .set_redirect_uri(RedirectUrl::from_url(redirect_url)))
    }

    async fn fresh_client(&self) -> OidcResult<DiscoveredClientWithExtra> {
        build_client(&self.config, self.provider.oidc_provider_metadata().await?).map_err(|e| {
            OidcError::Metadata {
                message: format!("Failed to rebuild OIDC client from provider metadata: {e}"),
            }
        })
    }

    async fn fresh_client_with_redirect_override(
        &self,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
    ) -> OidcResult<DiscoveredClientWithExtra> {
        let redirect_url = self.resolve_redirect_url(external_base_url, redirect_url_override)?;
        Ok(self
            .fresh_client()
            .await?
            .set_redirect_uri(RedirectUrl::from_url(redirect_url)))
    }

    pub fn authorize_url(
        &self,
        external_base_url: &Url,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        self.authorize_url_with_redirect_override(external_base_url, None)
    }

    pub fn authorize_url_with_redirect_override(
        &self,
        external_base_url: &Url,
        redirect_url_override: Option<&str>,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        let client =
            self.client_with_redirect_override(external_base_url, redirect_url_override)?;

        let mut req = client.authorize_url(
            AuthenticationFlow::<openidconnect::core::CoreResponseType>::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        );

        let pkce_verifier_secret = if self.pkce_enabled {
            let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
            req = req.set_pkce_challenge(pkce_challenge);
            Some(pkce_verifier.into_secret())
        } else {
            None
        };

        for scope in &self.scopes {
            req = req.add_scope(Scope::new(scope.clone()));
        }

        let (authorization_url, csrf_token, nonce) = req.url();
        Ok(OidcCodeFlowAuthorizationRequest {
            authorization_url,
            csrf_token,
            nonce,
            pkce_verifier_secret,
        })
    }

    pub async fn exchange_code(
        &self,
        external_base_url: &Url,
        code: &str,
        nonce: &Nonce,
        pkce_verifier_secret: Option<&str>,
    ) -> OidcResult<OidcCodeExchangeResult> {
        self.exchange_code_with_redirect_override(
            external_base_url,
            code,
            nonce,
            pkce_verifier_secret,
            None,
        )
        .await
    }

    pub async fn exchange_code_with_redirect_override(
        &self,
        external_base_url: &Url,
        code: &str,
        nonce: &Nonce,
        pkce_verifier_secret: Option<&str>,
        redirect_url_override: Option<&str>,
    ) -> OidcResult<OidcCodeExchangeResult> {
        let client = self
            .fresh_client_with_redirect_override(external_base_url, redirect_url_override)
            .await?;

        let mut token_request = client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .map_err(|e| OidcError::TokenExchange {
                message: format!("Token endpoint not set or config error: {e}"),
            })?;

        if let Some(secret) = pkce_verifier_secret {
            token_request =
                token_request.set_pkce_verifier(PkceCodeVerifier::new(secret.to_string()));
        }

        let token_response = token_request
            .request_async(self.provider.http_client())
            .await
            .map_err(|e| OidcError::TokenExchange {
                message: format!("Token exchange request failed: {e}"),
            })?;

        let id_token_verifier = client.id_token_verifier();
        let id_token =
            token_response
                .extra_fields()
                .id_token()
                .ok_or_else(|| OidcError::TokenExchange {
                    message: "Missing ID token in token response".to_string(),
                })?;

        let id_token_claims =
            id_token
                .claims(&id_token_verifier, nonce)
                .map_err(|e| OidcError::TokenExchange {
                    message: format!("Failed to verify ID token: {e}"),
                })?;

        let now = Utc::now();
        let id_token = id_token.to_string();
        let access_token = token_response.access_token().secret().clone();
        let access_token_expiration = token_response
            .expires_in()
            .map(|expires_in| now + expires_in);
        let refresh_token = token_response
            .refresh_token()
            .map(|value| value.secret().clone());

        let user_info_claims = if client.user_info_url().is_some() {
            Some(
                self.request_userinfo(
                    &client,
                    self.provider.http_client(),
                    token_response.access_token().clone(),
                    Some(id_token_claims.subject().clone()),
                )
                .await?,
            )
        } else {
            None
        };

        // Validate required scopes after successful exchange.
        self.check_required_scopes(token_response.scopes())?;

        Ok(OidcCodeExchangeResult {
            id_token,
            id_token_claims: id_token_claims.to_owned(),
            refresh_token,
            access_token,
            access_token_expiration,
            user_info_claims,
        })
    }

    /// Verify that the token response's `scope` field covers all
    /// `required_scopes` configured for this client.
    ///
    /// A `None` scope field in the response is treated as "unknown" and
    /// the check is skipped (the provider chose not to echo back the scope).
    /// Returns `Err(OidcError::ScopeValidation)` listing the missing scopes
    /// when the check fails.
    fn check_required_scopes(
        &self,
        response_scopes: Option<&Vec<openidconnect::Scope>>,
    ) -> OidcResult<()> {
        if self.config.required_scopes.is_empty() {
            return Ok(());
        }
        let granted = match response_scopes {
            Some(scopes) => scopes,
            // Provider omitted the scope field — skip check per RFC 6749 §5.1.
            None => return Ok(()),
        };
        let granted_strs: Vec<&str> = granted.iter().map(|s| s.as_str()).collect();
        let missing: Vec<String> = self
            .config
            .required_scopes
            .iter()
            .filter(|req| !granted_strs.contains(&req.as_str()))
            .cloned()
            .collect();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(OidcError::ScopeValidation { missing })
        }
    }

    fn with_runtime_flags(mut self) -> Self {
        self.scopes = self.config.scopes.clone();
        self.pkce_enabled = self.config.pkce_enabled;
        self
    }

    async fn request_device_token_once(
        &self,
        device_authorization: &OidcDeviceAuthorizationResult,
    ) -> OidcResult<DeviceTokenPollResponse> {
        let client = self.fresh_client().await?;
        let token_url = client
            .token_uri()
            .cloned()
            .ok_or_else(|| OidcError::DeviceTokenPoll {
                message: "Token endpoint not set for device token polling".to_string(),
            })?;

        let auth_type = self.resolve_token_endpoint_auth_type().await?;
        let mut params = vec![
            (
                Cow::Borrowed("grant_type"),
                Cow::Borrowed("urn:ietf:params:oauth:grant-type:device_code"),
            ),
            (
                Cow::Borrowed("device_code"),
                Cow::Owned(device_authorization.device_code.clone()),
            ),
        ];

        if matches!(auth_type, AuthType::RequestBody) {
            params.push((
                Cow::Borrowed("client_id"),
                Cow::Owned(self.config.client_id.clone()),
            ));
            if let Some(client_secret) = self.config.client_secret.as_ref() {
                params.push((
                    Cow::Borrowed("client_secret"),
                    Cow::Owned(client_secret.clone()),
                ));
            }
        }

        let mut request = self
            .provider
            .http_client()
            .post(token_url.url().clone())
            .header(reqwest::header::ACCEPT, "application/json")
            .form(&params);

        if matches!(auth_type, AuthType::BasicAuth) {
            let client_secret =
                self.config
                    .client_secret
                    .as_ref()
                    .ok_or_else(|| OidcError::DeviceTokenPoll {
                        message: "client_secret is required for basic token endpoint auth"
                            .to_string(),
                    })?;
            let credentials = format!(
                "{}:{}",
                form_urlencode(&self.config.client_id),
                form_urlencode(client_secret)
            );
            let header_value = format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD.encode(credentials)
            );
            request = request.header(reqwest::header::AUTHORIZATION, header_value);
        }

        let response = request
            .send()
            .await
            .map_err(|e| OidcError::DeviceTokenPoll {
                message: format!("Device token poll request failed: {e}"),
            })?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|e| OidcError::DeviceTokenPoll {
                message: format!("Failed to read device token poll response: {e}"),
            })?;

        if status.is_success() {
            let token_response =
                serde_json::from_slice::<TokenResponseWithExtra>(&body).map_err(|e| {
                    OidcError::DeviceTokenPoll {
                        message: format!(
                            "Failed to parse device token response: {e}; body: {}",
                            String::from_utf8_lossy(&body)
                        ),
                    }
                })?;
            return Ok(DeviceTokenPollResponse::Complete(Box::new(token_response)));
        }

        let error_response =
            serde_json::from_slice::<DeviceCodeErrorResponse>(&body).map_err(|e| {
                OidcError::DeviceTokenPoll {
                    message: format!(
                        "Device token poll failed with HTTP {} and an unparseable body: {e}; \
                         body: {}",
                        status,
                        String::from_utf8_lossy(&body)
                    ),
                }
            })?;

        match error_response.error() {
            DeviceCodeErrorResponseType::AuthorizationPending => {
                Ok(DeviceTokenPollResponse::Pending)
            }
            DeviceCodeErrorResponseType::SlowDown => Ok(DeviceTokenPollResponse::SlowDown),
            DeviceCodeErrorResponseType::AccessDenied => Ok(DeviceTokenPollResponse::Denied {
                error_description: error_response.error_description().cloned(),
            }),
            DeviceCodeErrorResponseType::ExpiredToken => Ok(DeviceTokenPollResponse::Expired {
                error_description: error_response.error_description().cloned(),
            }),
            other => Err(OidcError::DeviceTokenPoll {
                message: format!("Device token poll returned terminal error: {other}"),
            }),
        }
    }

    async fn build_device_token_result(
        &self,
        token_response: TokenResponseWithExtra,
    ) -> OidcResult<OidcDeviceTokenResult> {
        let client = self.fresh_client().await?;
        let id_token_verifier = client.id_token_verifier();
        let id_token =
            token_response
                .extra_fields()
                .id_token()
                .ok_or_else(|| OidcError::DeviceTokenPoll {
                    message: "Missing ID token in device token response".to_string(),
                })?;
        let id_token_claims = id_token
            .claims(&id_token_verifier, |_nonce: Option<&Nonce>| Ok(()))
            .map_err(|e| OidcError::DeviceTokenPoll {
                message: format!("Failed to verify device-flow ID token: {e}"),
            })?;

        let now = Utc::now();
        let access_token = token_response.access_token().secret().clone();
        let access_token_expiration = token_response
            .expires_in()
            .map(|expires_in| now + expires_in);
        let refresh_token = token_response
            .refresh_token()
            .map(|value| value.secret().clone());

        let user_info_claims = if client.user_info_url().is_some() {
            Some(
                self.request_userinfo(
                    &client,
                    self.provider.http_client(),
                    token_response.access_token().clone(),
                    Some(id_token_claims.subject().clone()),
                )
                .await?,
            )
        } else {
            None
        };
        let claims_check_result = self
            .check_claims(id_token_claims, user_info_claims.as_ref())
            .await?;

        Ok(OidcDeviceTokenResult {
            access_token,
            access_token_expiration,
            id_token: id_token.to_string(),
            refresh_token,
            id_token_claims: id_token_claims.to_owned(),
            user_info_claims,
            claims_check_result,
        })
    }

    async fn resolve_token_endpoint_auth_type(&self) -> OidcResult<AuthType> {
        let metadata = self.provider.oidc_provider_metadata().await?;
        let supported = metadata.token_endpoint_auth_methods_supported();

        if self.config.client_secret.is_none() {
            return Ok(AuthType::RequestBody);
        }

        let supports_basic = supported
            .is_none_or(|methods| methods.contains(&CoreClientAuthMethod::ClientSecretBasic));
        if supports_basic {
            return Ok(AuthType::BasicAuth);
        }

        let supports_request_body = supported.is_some_and(|methods| {
            methods.contains(&CoreClientAuthMethod::ClientSecretPost)
                || methods.contains(&CoreClientAuthMethod::None)
        });
        if supports_request_body {
            return Ok(AuthType::RequestBody);
        }

        Err(OidcError::DeviceTokenPoll {
            message: "The provider only advertises unsupported token endpoint auth methods for \
                      device polling"
                .to_string(),
        })
    }
}

enum DeviceTokenPollResponse {
    Pending,
    SlowDown,
    Denied { error_description: Option<String> },
    Expired { error_description: Option<String> },
    // Box the large variant to keep all arms at pointer size and silence
    // clippy::large_enum_variant
    Complete(Box<TokenResponseWithExtra>),
}

fn form_urlencode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn format_device_token_terminal_message(
    error_code: &str,
    error_description: Option<&str>,
) -> String {
    match error_description {
        Some(error_description) => {
            format!("Device token polling stopped with {error_code}: {error_description}")
        }
        None => format!("Device token polling stopped with {error_code}"),
    }
}

fn build_client(
    config: &OidcClientConfig<impl PendingOauthStoreConfig>,
    metadata: ProviderMetadataWithExtra,
) -> Result<DiscoveredClientWithExtra, String> {
    let client_id = ClientId::new(config.client_id.clone());
    let client_secret = config
        .client_secret
        .as_ref()
        .map(|value| ClientSecret::new(value.clone()));

    let introspection_endpoint = metadata
        .additional_metadata()
        .introspection_endpoint
        .as_ref()
        .map(|value| IntrospectionUrl::new(value.clone()))
        .transpose()
        .map_err(|e| format!("Invalid introspection_endpoint: {e}"))?;
    let revocation_endpoint = metadata
        .additional_metadata()
        .revocation_endpoint
        .as_ref()
        .map(|value| RevocationUrl::new(value.clone()))
        .transpose()
        .map_err(|e| format!("Invalid revocation_endpoint: {e}"))?;
    let device_authorization_endpoint = metadata
        .additional_metadata()
        .device_authorization_endpoint
        .as_ref()
        .map(|value| DeviceAuthorizationUrl::new(value.clone()))
        .transpose()
        .map_err(|e| format!("Invalid device_authorization_endpoint: {e}"))?;

    Ok(
        ClientWithExtra::from_provider_metadata(metadata, client_id, client_secret)
            .set_introspection_url_option(introspection_endpoint)
            .set_revocation_url_option(revocation_endpoint)
            .set_device_authorization_url_option(device_authorization_endpoint),
    )
}
