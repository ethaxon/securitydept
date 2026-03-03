use chrono::Utc;
use openidconnect::{
    AuthUrl, AuthenticationFlow, AuthorizationCode, Client, ClientId, ClientSecret, CsrfToken,
    DeviceAuthorizationUrl, EndpointMaybeSet, EndpointNotSet, EndpointSet, IntrospectionUrl,
    IssuerUrl, JsonWebKeySet, JsonWebKeySetUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge,
    PkceCodeVerifier, ProviderMetadata, RedirectUrl, RefreshToken, ResponseTypes, RevocationUrl,
    Scope, StandardErrorResponse, StandardTokenResponse, TokenUrl, UserInfoUrl,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreClaimName, CoreClaimType, CoreClientAuthMethod,
        CoreErrorResponseType, CoreGenderClaim, CoreGrantType, CoreJsonWebKey,
        CoreJweContentEncryptionAlgorithm, CoreJweKeyManagementAlgorithm, CoreResponseMode,
        CoreResponseType, CoreRevocableToken, CoreRevocationErrorResponse,
        CoreSubjectIdentifierType, CoreTokenIntrospectionResponse, CoreTokenType,
    },
    reqwest,
};
use url::Url;

#[cfg(not(feature = "claims-script"))]
use crate::claims::DefaultClaimsChecker;
#[cfg(feature = "claims-script")]
use crate::claims::ScriptClaimsChecker;
use crate::{
    ClaimsCheckResult, ExtraClaims, IdTokenClaimsWithExtra, OidcCodeCallbackSearchParams,
    OidcCodeExchangeResult, OidcCodeFlowAuthorizationRequest, PendingOauthStore,
    UserInfoClaimsWithExtra,
    claims::ClaimsChecker,
    config::{OidcConfig, default_id_token_signing_alg_values_supported},
    error::{OidcError, OidcResult},
    models::{
        ExtraProviderMetadata, IdTokenFieldsWithExtra, OidcCodeCallbackResult,
        OidcRefreshTokenResult,
    },
};
pub type TokenResponseWithExtra = StandardTokenResponse<IdTokenFieldsWithExtra, CoreTokenType>;

pub type ProviderMetadataWithExtra = ProviderMetadata<
    ExtraProviderMetadata,
    CoreAuthDisplay,
    CoreClientAuthMethod,
    CoreClaimName,
    CoreClaimType,
    CoreGrantType,
    CoreJweContentEncryptionAlgorithm,
    CoreJweKeyManagementAlgorithm,
    CoreJsonWebKey,
    CoreResponseMode,
    CoreResponseType,
    CoreSubjectIdentifierType,
>;

pub type ClientWithExtra<
    HasAuthUrl = EndpointNotSet,
    HasDeviceAuthUrl = EndpointNotSet,
    HasIntrospectionUrl = EndpointNotSet,
    HasRevocationUrl = EndpointNotSet,
    HasTokenUrl = EndpointNotSet,
    HasUserInfoUrl = EndpointNotSet,
> = Client<
    ExtraClaims,
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
    EndpointSet,      // HasAuthUrl
    EndpointMaybeSet, // HasDeviceAuthUrl
    EndpointMaybeSet, // HasIntrospectionUrl
    EndpointMaybeSet, // HasRevocationUrl
    EndpointMaybeSet, // HasTokenUrl
    EndpointMaybeSet, // HasUserInfoUrl
>;

/// Wraps the OIDC discovered client for login/callback flows.
///
/// The redirect URI is resolved dynamically per-request so that
/// `external_base_url = "auto"` can produce the correct absolute callback URL
/// based on the incoming request headers.
pub struct OidcClient {
    config: OidcConfig,
    client: DiscoveredClientWithExtra,
    #[cfg(feature = "claims-script")]
    claims_checker: ScriptClaimsChecker,
    #[cfg(not(feature = "claims-script"))]
    claims_checker: DefaultClaimsChecker,
    master_key_aead: Option<orion::aead::SecretKey>,
    scopes: Vec<String>,
    pkce_enabled: bool,
}

impl OidcClient {
    /// Initialize the OIDC client from config.
    ///
    /// When `well_known_url` is set: fetch discovery from that URL, then
    /// override any endpoint URLs provided in config. When not set: use
    /// `issuer_url` and required endpoints (authorization, token, jwks_uri).
    /// `userinfo` is recommended and only used when configured.
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

        let introspection_endpoint = metadata
            .additional_metadata()
            .introspection_endpoint
            .as_ref()
            .map(|s| IntrospectionUrl::new(s.to_string()))
            .transpose()
            .map_err(|e| OidcError::Metadata {
                message: format!("Invalid introspection_endpoint: {e}"),
            })?;
        let revocation_endpoint = metadata
            .additional_metadata()
            .revocation_endpoint
            .as_ref()
            .map(|s| RevocationUrl::new(s.to_string()))
            .transpose()
            .map_err(|e| OidcError::Metadata {
                message: format!("Invalid revocation_endpoint: {e}"),
            })?;
        let device_authorization_endpoint = metadata
            .additional_metadata()
            .device_authorization_endpoint
            .as_ref()
            .map(|s| DeviceAuthorizationUrl::new(s.to_string()))
            .transpose()
            .map_err(|e| OidcError::Metadata {
                message: format!("Invalid device_authorization_endpoint: {e}"),
            })?;

        let client = ClientWithExtra::from_provider_metadata(metadata, client_id, client_secret)
            .set_introspection_url_option(introspection_endpoint)
            .set_revocation_url_option(revocation_endpoint)
            .set_device_authorization_url_option(device_authorization_endpoint);

        #[cfg(feature = "claims-script")]
        let claims_checker =
            ScriptClaimsChecker::from_file(config.claims_check_script.as_deref()).await?;
        #[cfg(not(feature = "claims-script"))]
        let claims_checker = DefaultClaimsChecker;

        let master_key_aead = config
            .master_key
            .as_ref()
            .map(|master_key| {
                orion::aead::SecretKey::from_slice(master_key.as_bytes()).map_err(|e| {
                    OidcError::InvalidConfig {
                        message: format!("Failed to parse master key: {e}"),
                    }
                })
            })
            .transpose()?;

        Ok(Self {
            client,
            scopes: config.scopes.clone(),
            pkce_enabled: config.pkce_enabled,
            claims_checker,
            config,
            master_key_aead,
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
        let http_client =
            reqwest::Client::builder()
                .build()
                .map_err(|e| OidcError::TokenExchange {
                    message: format!("Failed to build HTTP client: {e}"),
                })?;

        let refresh_token = self.unseal_refresh_token(refresh_token)?;

        let now = Utc::now();
        let token_response = self
            .client
            .exchange_refresh_token(&refresh_token)
            .map_err(|e| OidcError::TokenRefresh {
                message: format!("Token endpoint not set or config error: {e}"),
            })?
            .request_async(&http_client)
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
            .map(|v| self.seal_refresh_token(v))
            .transpose()?;

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
            let id_token_verifier = self.client.id_token_verifier();
            let id_token_claims = next_id_token
                .claims(&id_token_verifier, |_nonce: Option<&Nonce>| Ok(()))
                .map_err(|e| OidcError::TokenExchange {
                    message: format!("Failed to verify refreshed ID token: {e}"),
                })?;
            let user_info_claims = if self.client.user_info_url().is_some() {
                Some(
                    self.request_userinfo(
                        &self.client,
                        &http_client,
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

    async fn request_userinfo(
        &self,
        client: &DiscoveredClientWithExtra,
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

    async fn check_claims(
        &self,
        id_token_claims: &IdTokenClaimsWithExtra,
        user_info_claims: Option<&UserInfoClaimsWithExtra>,
    ) -> OidcResult<ClaimsCheckResult> {
        self.claims_checker
            .check_claims(id_token_claims, user_info_claims)
            .await
    }

    async fn fetch_and_merge_metadata(
        config: &OidcConfig,
        well_known_url: &str,
        http_client: &reqwest::Client,
    ) -> OidcResult<ProviderMetadataWithExtra> {
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

        let mut metadata: ProviderMetadataWithExtra =
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

        if let Some(introspection_endpoint) = config.introspection_endpoint.as_ref() {
            metadata.additional_metadata_mut().introspection_endpoint =
                Some(introspection_endpoint.clone());
        }

        if let Some(revocation_endpoint) = config.revocation_endpoint.as_ref() {
            metadata.additional_metadata_mut().revocation_endpoint =
                Some(revocation_endpoint.clone());
        }

        if let Some(device_authorization_endpoint) = config.device_authorization_endpoint.as_ref() {
            metadata
                .additional_metadata_mut()
                .device_authorization_endpoint = Some(device_authorization_endpoint.clone());
        }

        Ok(metadata)
    }

    async fn build_metadata_manual(config: &OidcConfig) -> OidcResult<ProviderMetadataWithExtra> {
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
        let userinfo_url = config
            .userinfo_endpoint
            .as_deref()
            .map(|s| UserInfoUrl::new(s.to_string()))
            .transpose()
            .map_err(|e| OidcError::Metadata {
                message: format!("Invalid userinfo_endpoint: {e}"),
            })?;

        let id_token_signing_alg_values_supported = config
            .id_token_signing_alg_values_supported
            .clone()
            .unwrap_or_else(default_id_token_signing_alg_values_supported);

        let metadata = ProviderMetadataWithExtra::new(
            issuer_url,
            authorization_endpoint,
            jwks_uri,
            vec![ResponseTypes::new(vec![CoreResponseType::Code])],
            vec![CoreSubjectIdentifierType::Public],
            id_token_signing_alg_values_supported,
            ExtraProviderMetadata {
                introspection_endpoint: config.introspection_endpoint.clone(),
                revocation_endpoint: config.revocation_endpoint.clone(),
                device_authorization_endpoint: config.device_authorization_endpoint.clone(),
                extra: serde_json::Value::default(),
            },
        )
        .set_token_endpoint(Some(token_url))
        .set_userinfo_endpoint(userinfo_url)
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
    ) -> OidcResult<DiscoveredClientWithExtra> {
        let redirect_url = self.resolve_redirect_url(external_base_url)?;
        Ok(self
            .client
            .clone()
            .set_redirect_uri(RedirectUrl::from_url(redirect_url)))
    }

    /// Generate the authorization URL the user should be redirected to.
    ///
    /// When `pkce_enabled` (config), the fourth element is the PKCE
    /// code_verifier secret to store and pass to `exchange_code` in the
    /// callback.
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

    /// Exchange the authorization code for tokens.
    /// If `userinfo_endpoint` is configured, also fetch user info claims.
    ///
    /// When PKCE was used at authorize_url, pass the stored code_verifier
    /// secret here. `external_base_url` must match the one used during
    /// [`authorize_url`].
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

        let now = Utc::now();
        let id_token = id_token.to_string();
        let access_token = token_response.access_token().secret().clone();
        let access_token_expiration = token_response
            .expires_in()
            .map(|expires_in| now + expires_in);
        let refresh_token = token_response
            .refresh_token()
            .map(|v| self.seal_refresh_token(v))
            .transpose()?;

        let user_info_claims = if self.client.user_info_url().is_some() {
            let user_info_claims = self
                .request_userinfo(&client, &http_client, token_response.access_token().clone())
                .await?;
            Some(user_info_claims)
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

    fn seal_refresh_token(&self, refresh_token: &RefreshToken) -> OidcResult<String> {
        let refresh_token = refresh_token.secret();
        if self.config.sealed_refresh_token {
            let master_key =
                self.master_key_aead
                    .as_ref()
                    .ok_or_else(|| OidcError::InvalidConfig {
                        message: "Master key is required to when sealed refresh token is enabled"
                            .to_string(),
                    })?;
            let sealed_refresh_token = orion::aead::seal(master_key, refresh_token.as_bytes())
                .map_err(|e| OidcError::RefreshTokenSealing {
                    message: format!("Failed to seal refresh token: {e}"),
                })?;
            Ok(String::from_utf8_lossy(&sealed_refresh_token).to_string())
        } else {
            Ok(refresh_token.clone())
        }
    }

    fn unseal_refresh_token(&self, refresh_token: String) -> OidcResult<RefreshToken> {
        if self.config.sealed_refresh_token {
            let master_key =
                self.master_key_aead
                    .as_ref()
                    .ok_or_else(|| OidcError::InvalidConfig {
                        message: "Master key is required to when sealed refresh token is enabled"
                            .to_string(),
                    })?;
            let unsealed_refresh_token = orion::aead::open(master_key, refresh_token.as_bytes())
                .map_err(|e| OidcError::RefreshTokenSealing {
                    message: format!("Failed to unseal refresh token: {e}"),
                })?;
            Ok(RefreshToken::new(
                String::from_utf8_lossy(&unsealed_refresh_token).to_string(),
            ))
        } else {
            Ok(RefreshToken::new(refresh_token))
        }
    }
}
