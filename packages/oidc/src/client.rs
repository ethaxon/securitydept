use openidconnect::EmptyAdditionalProviderMetadata;
use openidconnect::core::{CoreProviderMetadata, CoreResponseType, CoreSubjectIdentifierType};
use openidconnect::{
    AuthUrl, AuthenticationFlow, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl,
    JsonWebKeySet, JsonWebKeySetUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, ResponseTypes, Scope, TokenUrl, UserInfoUrl, reqwest,
};
use url::Url;

use crate::config::{OidcConfig, default_id_token_signing_alg_values_supported};
use crate::error::{OidcError, OidcResult};
use crate::models::{DiscoveredClient, DiscoveredClientWithRedirect};

/// Wraps the OIDC discovered client for login/callback flows.
///
/// The redirect URI is resolved dynamically per-request so that `external_base_url = "auto"`
/// can produce the correct absolute callback URL based on the incoming request headers.
pub struct OidcClient {
    config: OidcConfig,
    client: DiscoveredClient,
    #[cfg(feature = "claims-script")]
    claims_script_source: Option<String>,
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

        Ok(Self {
            client,
            scopes: config.scopes.clone(),
            pkce_enabled: config.pkce_enabled,
            config,
            #[cfg(feature = "claims-script")]
            claims_script_source: None,
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
            .map_err(|e| OidcError::Metadata {
                message: format!("Invalid redirect URL {e}"),
            })?;
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
    ) -> OidcResult<(String, CsrfToken, Nonce, Option<String>)> {
        let client = self.client_with_redirect(external_base_url)?;

        let mut req = client.authorize_url(
            AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        );

        let pkce_verifier_secret = if self.pkce_enabled {
            let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
            req = req.set_pkce_challenge(pkce_challenge);
            Some(pkce_verifier.secret().to_string())
        } else {
            None
        };

        for scope in &self.scopes {
            req = req.add_scope(Scope::new(scope.clone()));
        }

        let (url, csrf, nonce) = req.url();
        Ok((url.to_string(), csrf, nonce, pkce_verifier_secret))
    }

    /// Exchange the authorization code for tokens, then fetch user info claims.
    ///
    /// When PKCE was used at authorize_url, pass the stored code_verifier secret here.
    /// `external_base_url` must match the one used during [`authorize_url`].
    pub async fn exchange_code(
        &self,
        code: &str,
        external_base_url: &Url,
        _nonce: &Nonce,
        pkce_verifier_secret: Option<&str>,
    ) -> OidcResult<serde_json::Value> {
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
                message: format!("Token exchange failed: {e}"),
            })?;

        let claims_value = self
            .request_userinfo(&client, &http_client, token_response.access_token().clone())
            .await?;
        Ok(claims_value)
    }

    async fn request_userinfo(
        &self,
        client: &DiscoveredClientWithRedirect,
        http_client: &reqwest::Client,
        access_token: openidconnect::AccessToken,
    ) -> OidcResult<serde_json::Value> {
        use crate::models::UserInfoClaimsWithExtra;

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

        serde_json::to_value(&userinfo_claims).map_err(|e| OidcError::Claims {
            message: format!("Failed to serialize claims: {e}"),
        })
    }
}
