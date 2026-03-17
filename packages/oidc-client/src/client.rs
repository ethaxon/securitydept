use std::sync::Arc;

use chrono::Utc;
use openidconnect::{
    AccessToken, AuthenticationFlow, AuthorizationCode, Client, ClientId, ClientSecret, CsrfToken,
    DeviceAuthorizationUrl, EndpointMaybeSet, EndpointNotSet, EndpointSet, IntrospectionUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, RefreshToken,
    RevocationUrl, Scope, StandardErrorResponse, StandardTokenResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreDeviceAuthorizationResponse, CoreErrorResponseType,
        CoreGenderClaim, CoreJsonWebKey, CoreJweContentEncryptionAlgorithm, CoreRevocableToken,
        CoreRevocationErrorResponse, CoreTokenIntrospectionResponse, CoreTokenType,
    },
    reqwest,
};
use securitydept_oauth_provider::{OAuthProviderRuntime, ProviderMetadataWithExtra};
use url::Url;

#[cfg(not(feature = "claims-script"))]
use crate::claims::DefaultClaimsChecker;
#[cfg(feature = "claims-script")]
use crate::claims::ScriptClaimsChecker;
use crate::{
    ClaimsCheckResult, ExtraOidcClaims, IdTokenClaimsWithExtra, OidcCodeCallbackSearchParams,
    OidcCodeExchangeResult, OidcCodeFlowAuthorizationRequest, OidcDeviceAuthorizationResult,
    OidcRevocableToken, PendingOauthStore, UserInfoClaimsWithExtra,
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
pub struct OidcClient {
    config: OidcClientConfig,
    provider: Arc<OAuthProviderRuntime>,
    base_client: DiscoveredClientWithExtra,
    #[cfg(feature = "claims-script")]
    claims_checker: ScriptClaimsChecker,
    #[cfg(not(feature = "claims-script"))]
    claims_checker: DefaultClaimsChecker,
    scopes: Vec<String>,
    pkce_enabled: bool,
}

impl OidcClient {
    pub async fn from_config(config: OidcClientConfig) -> OidcResult<Self> {
        config.validate()?;
        let provider = Arc::new(OAuthProviderRuntime::from_config(config.provider_config()).await?);
        Self::from_provider(provider, config).await
    }

    pub async fn from_provider(
        provider: Arc<OAuthProviderRuntime>,
        config: OidcClientConfig,
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
        pending_oauth_store: &impl PendingOauthStore,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        let authorization_request = self.authorize_url(external_base_url)?;
        pending_oauth_store
            .insert(
                authorization_request.csrf_token.secret().to_string(),
                authorization_request.nonce.secret().to_string(),
                authorization_request.pkce_verifier_secret.clone(),
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
            expires_in_seconds: details.expires_in().as_secs(),
            interval_seconds: Some(details.interval().as_secs()),
        })
    }

    pub async fn handle_code_callback(
        &self,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
        pending_oauth_store: &impl PendingOauthStore,
    ) -> OidcResult<OidcCodeCallbackResult> {
        let code = &search_params.code;
        let state = search_params
            .state
            .as_ref()
            .ok_or_else(|| OidcError::CSRFValidation {
                message: "Missing state parameter in callback (required for CSRF validation)"
                    .to_string(),
            })?;

        let pending =
            pending_oauth_store
                .take(state)
                .await?
                .ok_or_else(|| OidcError::PendingOauth {
                    source: "Invalid or expired state (reuse or unknown); try logging in again"
                        .to_string()
                        .into(),
                })?;

        let nonce = openidconnect::Nonce::new(pending.nonce.clone());
        let code_verifier = pending.code_verifier;

        let code_exchange = self
            .exchange_code(external_base_url, code, &nonce, code_verifier.as_deref())
            .await?;

        let claims_check_result = self
            .check_claims(
                &code_exchange.id_token_claims,
                code_exchange.user_info_claims.as_ref(),
            )
            .await?;

        Ok(OidcCodeCallbackResult {
            code: search_params.code,
            pkce_verifier_secret: code_verifier,
            state: search_params.state,
            nonce: pending.nonce,
            access_token: code_exchange.access_token,
            access_token_expiration: code_exchange.access_token_expiration,
            id_token: code_exchange.id_token,
            refresh_token: code_exchange.refresh_token,
            id_token_claims: code_exchange.id_token_claims,
            user_info_claims: code_exchange.user_info_claims,
            claims_check_result,
        })
    }

    pub async fn handle_token_refresh(
        &self,
        refresh_token: String,
    ) -> OidcResult<OidcRefreshTokenResult> {
        let client = self.fresh_client().await?;
        let refresh_token = RefreshToken::new(refresh_token);
        let now = Utc::now();

        let token_response = client
            .exchange_refresh_token(&refresh_token)
            .map_err(|e| OidcError::TokenRefresh {
                message: format!("Token endpoint not set or config error: {e}"),
            })?
            .request_async(self.provider.http_client())
            .await
            .map_err(|e| OidcError::TokenRefresh {
                message: format!("Refresh token request failed: {e}"),
            })?;

        let access_token = token_response.access_token().secret().clone();
        let access_token_expiration = token_response
            .expires_in()
            .map(|expires_in| now + expires_in);
        let refresh_token = token_response
            .refresh_token()
            .map(|value| value.secret().clone());

        let mut result = OidcRefreshTokenResult {
            access_token,
            access_token_expiration,
            refresh_token,
            id_token: None,
            user_info_claims: None,
            claims_check_result: None,
            id_token_claims: None,
        };

        if let Some(next_id_token) = token_response.extra_fields().id_token() {
            let id_token_verifier = client.id_token_verifier();
            let id_token_claims = next_id_token
                .claims(&id_token_verifier, |_nonce: Option<&Nonce>| Ok(()))
                .map_err(|e| OidcError::TokenExchange {
                    message: format!("Failed to verify refreshed ID token: {e}"),
                })?;
            let user_info_claims = if client.user_info_url().is_some() {
                Some(
                    self.request_userinfo(
                        &client,
                        self.provider.http_client(),
                        token_response.access_token().clone(),
                    )
                    .await?,
                )
            } else {
                None
            };
            let claims_check_result = self
                .check_claims(id_token_claims, user_info_claims.as_ref())
                .await?;
            result.id_token = Some(next_id_token.to_string());
            result.id_token_claims = Some(id_token_claims.clone());
            result.user_info_claims = user_info_claims;
            result.claims_check_result = Some(claims_check_result);
        }

        Ok(result)
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

    async fn request_userinfo(
        &self,
        client: &DiscoveredClientWithExtra,
        http_client: &reqwest::Client,
        access_token: openidconnect::AccessToken,
    ) -> OidcResult<UserInfoClaimsWithExtra> {
        client
            .user_info(access_token, None)
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

    fn resolve_redirect_url(&self, external_base_url: &Url) -> OidcResult<Url> {
        external_base_url
            .join(&self.config.redirect_url)
            .map_err(|e| OidcError::RedirectUrl { source: e })
    }

    fn client_with_redirect(
        &self,
        external_base_url: &Url,
    ) -> OidcResult<DiscoveredClientWithExtra> {
        let redirect_url = self.resolve_redirect_url(external_base_url)?;
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

    async fn fresh_client_with_redirect(
        &self,
        external_base_url: &Url,
    ) -> OidcResult<DiscoveredClientWithExtra> {
        let redirect_url = self.resolve_redirect_url(external_base_url)?;
        Ok(self
            .fresh_client()
            .await?
            .set_redirect_uri(RedirectUrl::from_url(redirect_url)))
    }

    pub fn authorize_url(
        &self,
        external_base_url: &Url,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        let client = self.client_with_redirect(external_base_url)?;

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
        let client = self.fresh_client_with_redirect(external_base_url).await?;

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
                )
                .await?,
            )
        } else {
            None
        };

        Ok(OidcCodeExchangeResult {
            id_token,
            id_token_claims: id_token_claims.to_owned(),
            refresh_token,
            access_token,
            access_token_expiration,
            user_info_claims,
        })
    }

    fn with_runtime_flags(mut self) -> Self {
        self.scopes = self.config.scopes.clone();
        self.pkce_enabled = self.config.pkce_enabled;
        self
    }
}

fn build_client(
    config: &OidcClientConfig,
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
