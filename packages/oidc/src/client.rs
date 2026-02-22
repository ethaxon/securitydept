use openidconnect::EmptyAdditionalProviderMetadata;
use openidconnect::core::{CoreProviderMetadata, CoreResponseType, CoreSubjectIdentifierType};
use openidconnect::{
    AuthUrl, AuthenticationFlow, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl,
    JsonWebKeySet, JsonWebKeySetUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, ResponseTypes, Scope, TokenUrl, UserInfoUrl, reqwest,
};
use openidconnect::{EndpointMaybeSet, EndpointSet, core::CoreClient};

use url::Url;

use crate::claims::ClaimsChecker;
#[cfg(feature = "claims-script")]
use crate::claims::ScriptClaimsChecker;
use crate::config::{OidcConfig, default_id_token_signing_alg_values_supported};
use crate::error::{OidcError, OidcResult};
use crate::models::OidcCodeCallbackResult;
use crate::{
    ClaimsCheckResult, OidcCodeCallbackSearchParams, OidcCodeExchangeResult,
    OidcCodeFlowAuthorizationRequest, PendingOauthStore, UserInfoClaimsWithExtra,
};

/// Type alias for the discovered client *without* a fixed redirect URI.
pub type DiscoveredClient = CoreClient<
    EndpointSet,                   // HasAuthUrl
    openidconnect::EndpointNotSet, // HasDeviceAuthUrl
    openidconnect::EndpointNotSet, // HasIntrospectionUrl
    openidconnect::EndpointNotSet, // HasRevocationUrl
    EndpointMaybeSet,              // HasTokenUrl
    EndpointMaybeSet,              // HasUserInfoUrl
>;

/// Type alias for the discovered client *with* a fixed redirect URI.
pub type DiscoveredClientWithRedirect = CoreClient<
    EndpointSet,                   // HasAuthUrl
    openidconnect::EndpointNotSet, // HasDeviceAuthUrl
    openidconnect::EndpointNotSet, // HasIntrospectionUrl
    openidconnect::EndpointNotSet, // HasRevocationUrl
    EndpointMaybeSet,              // HasTokenUrl
    EndpointMaybeSet,              // HasUserInfoUrl
>;

/// Wraps the OIDC discovered client for login/callback flows.
///
/// The redirect URI is resolved dynamically per-request so that `external_base_url = "auto"`
/// can produce the correct absolute callback URL based on the incoming request headers.
pub struct OidcClient {
    config: OidcConfig,
    client: DiscoveredClient,
    #[cfg(feature = "claims-script")]
    claims_checker: ScriptClaimsChecker,
    #[cfg(not(feature = "claims-script"))]
    claims_checker: DefaultClaimsChecker,
    scopes: Vec<String>,
    pkce_enabled: bool,
}

impl OidcClient {
    /// Initialize the OIDC client from config.
    ///
    /// When `well_known_url` is set: fetch discovery from that URL, then override any
    /// endpoint URLs provided in config. When not set: use `issuer_url` and the four
    /// required endpoints (authorization, token, userinfo, jwks_uri).
    ///
    /// The redirect URI is **not** baked in here; call [`authorize_url`] or
    /// [`exchange_code`] with the resolved `external_base_url` at request time.
    pub async fn from_config(config: OidcConfig) -> OidcResult<Self> {
        let client_id = ClientId::new(config.client_id.clone());
        let client_secret = config
            .client_secret
            .as_ref()
            .map(|s| ClientSecret::new(s.clone()));

        let http_client = reqwest::Client::builder()
            .build()
            .map_err(|e| OidcError::Metadata {
                message: format!("Failed to build HTTP client: {e}"),
            })?;

        let metadata = if let Some(ref well_known_url) = config.well_known_url {
            Self::fetch_and_merge_metadata(&config, well_known_url, &http_client).await?
        } else {
            Self::build_metadata_manual(&config).await?
        };

        let jwks = JsonWebKeySet::fetch_async(metadata.jwks_uri(), &http_client)
            .await
            .map_err(|e| OidcError::Metadata {
                message: format!("Failed to fetch JWKS: {e}"),
            })?;

        let metadata = metadata.set_jwks(jwks);

        let client = openidconnect::core::CoreClient::from_provider_metadata(
            metadata,
            client_id,
            client_secret,
        );

        #[cfg(feature = "claims-script")]
        let claims_checker =
            ScriptClaimsChecker::from_file(config.claims_check_script.as_deref()).await?;
        #[cfg(not(feature = "claims-script"))]
        let claims_checker = DefaultClaimsChecker;

        Ok(Self {
            client,
            scopes: config.scopes.clone(),
            pkce_enabled: config.pkce_enabled,
            claims_checker,
            config,
        })
    }

    async fn fetch_and_merge_metadata(
        config: &OidcConfig,
        well_known_url: &str,
        http_client: &reqwest::Client,
    ) -> OidcResult<CoreProviderMetadata> {
        let body = http_client
            .get(well_known_url)
            .send()
            .await
            .map_err(|e| OidcError::Metadata {
                message: format!("Failed to fetch discovery document: {e}"),
            })?
            .bytes()
            .await
            .map_err(|e| OidcError::Metadata {
                message: format!("Failed to read discovery response: {e}"),
            })?;

        let mut metadata: CoreProviderMetadata =
            serde_json::from_slice(&body).map_err(|e| OidcError::Metadata {
                message: format!("Failed to parse discovery document: {e}"),
            })?;

        if let Some(issuer_url) = config.issuer_url.as_ref() {
            let issuer_url =
                IssuerUrl::new(issuer_url.clone()).map_err(|e| OidcError::Metadata {
                    message: format!("Invalid issuer_url: {e}"),
                })?;
            metadata = metadata.set_issuer(issuer_url);
        }

        if let Some(authorization_endpoint) = config.authorization_endpoint.as_ref() {
            let authorization_endpoint =
                AuthUrl::new(authorization_endpoint.clone()).map_err(|e| OidcError::Metadata {
                    message: format!("Invalid authorization_endpoint: {e}"),
                })?;
            metadata = metadata.set_authorization_endpoint(authorization_endpoint);
        }

        if let Some(token_endpoint) = config.token_endpoint.as_ref() {
            let token_endpoint =
                TokenUrl::new(token_endpoint.clone()).map_err(|e| OidcError::Metadata {
                    message: format!("Invalid token_endpoint: {e}"),
                })?;
            metadata = metadata.set_token_endpoint(Some(token_endpoint));
        }

        if let Some(userinfo_endpoint) = config.userinfo_endpoint.as_ref() {
            let userinfo_endpoint =
                UserInfoUrl::new(userinfo_endpoint.clone()).map_err(|e| OidcError::Metadata {
                    message: format!("Invalid userinfo_endpoint: {e}"),
                })?;
            metadata = metadata.set_userinfo_endpoint(Some(userinfo_endpoint));
        }

        if let Some(jwks_uri) = config.jwks_uri.as_ref() {
            let jwks_uri =
                JsonWebKeySetUrl::new(jwks_uri.clone()).map_err(|e| OidcError::Metadata {
                    message: format!("Invalid jwks_uri: {e}"),
                })?;
            metadata = metadata.set_jwks_uri(jwks_uri);
        }

        if let Some(id_token_signing_alg_values_supported) =
            config.id_token_signing_alg_values_supported.as_ref()
        {
            metadata = metadata.set_id_token_signing_alg_values_supported(
                id_token_signing_alg_values_supported.clone(),
            );
        }

        if let Some(userinfo_signing_alg_values_supported) =
            config.userinfo_signing_alg_values_supported.as_ref()
        {
            metadata = metadata.set_userinfo_signing_alg_values_supported(Some(
                userinfo_signing_alg_values_supported.clone(),
            ));
        }

        if let Some(token_endpoint_auth_methods_supported) =
            config.token_endpoint_auth_methods_supported.as_ref()
        {
            metadata = metadata.set_token_endpoint_auth_methods_supported(Some(
                token_endpoint_auth_methods_supported.clone(),
            ));
        }

        Ok(metadata)
    }

    async fn build_metadata_manual(config: &OidcConfig) -> OidcResult<CoreProviderMetadata> {
        let issuer_url = IssuerUrl::new(
            config.issuer_url.as_deref().unwrap_or_default().to_string(),
        )
        .map_err(|e| OidcError::Metadata {
            message: format!("Invalid issuer_url: {e}"),
        })?;
        let authorization_endpoint = AuthUrl::new(
            config
                .authorization_endpoint
                .as_deref()
                .unwrap_or_default()
                .to_string(),
        )
        .map_err(|e| OidcError::Metadata {
            message: format!("Invalid authorization_endpoint: {e}"),
        })?;
        let jwks_uri =
            JsonWebKeySetUrl::new(config.jwks_uri.as_deref().unwrap_or_default().to_string())
                .map_err(|e| OidcError::Metadata {
                    message: format!("Invalid jwks_uri: {e}"),
                })?;

        let token_url = TokenUrl::new(
            config
                .token_endpoint
                .as_deref()
                .unwrap_or_default()
                .to_string(),
        )
        .map_err(|e| OidcError::Metadata {
            message: format!("Invalid token_endpoint: {e}"),
        })?;
        let userinfo_url = UserInfoUrl::new(
            config
                .userinfo_endpoint
                .as_deref()
                .unwrap_or_default()
                .to_string(),
        )
        .map_err(|e| OidcError::Metadata {
            message: format!("Invalid userinfo_endpoint: {e}"),
        })?;

        let id_token_signing_alg_values_supported = config
            .id_token_signing_alg_values_supported
            .clone()
            .unwrap_or_else(default_id_token_signing_alg_values_supported);

        let metadata = CoreProviderMetadata::new(
            issuer_url,
            authorization_endpoint,
            jwks_uri,
            vec![ResponseTypes::new(vec![CoreResponseType::Code])],
            vec![CoreSubjectIdentifierType::Public],
            id_token_signing_alg_values_supported,
            EmptyAdditionalProviderMetadata::default(),
        )
        .set_token_endpoint(Some(token_url))
        .set_userinfo_endpoint(Some(userinfo_url))
        .set_userinfo_signing_alg_values_supported(
            config.userinfo_signing_alg_values_supported.clone(),
        )
        .set_token_endpoint_auth_methods_supported(
            config.token_endpoint_auth_methods_supported.clone(),
        );

        Ok(metadata)
    }

    fn resolve_redirect_url(&self, external_base_url: &Url) -> OidcResult<Url> {
        let redirect_url = external_base_url
            .join(&self.config.redirect_url)
            .map_err(|e| OidcError::RedirectUrl { source: e })?;
        Ok(redirect_url)
    }

    fn client_with_redirect(
        &self,
        external_base_url: &Url,
    ) -> OidcResult<DiscoveredClientWithRedirect> {
        let redirect_url = self.resolve_redirect_url(external_base_url)?;
        Ok(self
            .client
            .clone()
            .set_redirect_uri(RedirectUrl::from_url(redirect_url)))
    }

    /// Generate the authorization URL the user should be redirected to.
    ///
    /// When `pkce_enabled` (config), the fourth element is the PKCE code_verifier secret to store
    /// and pass to `exchange_code` in the callback.
    pub fn authorize_url(
        &self,
        external_base_url: &Url,
    ) -> OidcResult<OidcCodeFlowAuthorizationRequest> {
        let client = self.client_with_redirect(external_base_url)?;

        let mut req = client.authorize_url(
            AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
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

    /// Exchange the authorization code for tokens, then fetch user info claims.
    ///
    /// When PKCE was used at authorize_url, pass the stored code_verifier secret here.
    /// `external_base_url` must match the one used during [`authorize_url`].
    pub async fn exchange_code(
        &self,
        external_base_url: &Url,
        code: &str,
        nonce: &Nonce,
        pkce_verifier_secret: Option<&str>,
    ) -> OidcResult<OidcCodeExchangeResult> {
        let client = self.client_with_redirect(external_base_url)?;

        let http_client =
            reqwest::Client::builder()
                .build()
                .map_err(|e| OidcError::TokenExchange {
                    message: format!("Failed to build HTTP client: {e}"),
                })?;

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
            .request_async(&http_client)
            .await
            .map_err(|e| OidcError::TokenExchange {
                message: format!("Token exchange request failed: {e}"),
            })?;

        let id_token_verifier = self.client.id_token_verifier();

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

        let id_token = id_token.to_string();
        let access_token = token_response.access_token().secret().clone();
        let refresh_token = token_response.refresh_token().map(|v| v.secret().clone());

        let user_info_claims = self
            .request_userinfo(&client, &http_client, token_response.access_token().clone())
            .await?;

        Ok(OidcCodeExchangeResult {
            id_token,
            id_token_claims: id_token_claims.to_owned(),
            refresh_token,
            access_token,
            user_info_claims,
        })
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

        let claims_check_result = self.check_claims(&code_exchange.user_info_claims).await?;

        Ok(OidcCodeCallbackResult {
            code: search_params.code,
            pkce_verifier_secret: code_verifier,
            state: search_params.state,
            nonce: pending.nonce,
            access_token: code_exchange.access_token,
            id_token: code_exchange.id_token,
            refresh_token: code_exchange.refresh_token,
            id_token_claims: code_exchange.id_token_claims,
            user_info_claims: code_exchange.user_info_claims,
            claims_check_result,
        })
    }

    async fn request_userinfo(
        &self,
        client: &DiscoveredClientWithRedirect,
        http_client: &reqwest::Client,
        access_token: openidconnect::AccessToken,
    ) -> OidcResult<UserInfoClaimsWithExtra> {
        let userinfo_claims: UserInfoClaimsWithExtra = client
            .user_info(access_token, None)
            .map_err(|e| OidcError::Claims {
                message: format!("UserInfo request configuration failed: {e}"),
            })?
            .request_async(http_client)
            .await
            .map_err(|e| OidcError::Claims {
                message: format!("UserInfo request failed: {e}"),
            })?;

        Ok(userinfo_claims)
    }

    pub async fn check_claims(
        &self,
        claims: &UserInfoClaimsWithExtra,
    ) -> OidcResult<ClaimsCheckResult> {
        self.claims_checker.check_claims(claims).await
    }
}
