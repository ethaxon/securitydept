use openidconnect::EmptyAdditionalProviderMetadata;
use openidconnect::core::{
    CoreGenderClaim, CoreProviderMetadata, CoreResponseType, CoreSubjectIdentifierType,
};
use openidconnect::{
    AdditionalClaims, AuthUrl, AuthenticationFlow, AuthorizationCode, ClientId, ClientSecret,
    CsrfToken, EndpointMaybeSet, EndpointSet, IssuerUrl, JsonWebKeySet, JsonWebKeySetUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, ResponseTypes, Scope,
    TokenUrl, UserInfoClaims, UserInfoUrl, reqwest,
};
use serde::{Deserialize, Serialize};

use crate::config::{OidcConfig, default_id_token_signing_alg_values_supported};
use crate::error::{Error, Result};

/// Additional claims we accept from the OIDC provider (open-ended).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraClaims {
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

impl AdditionalClaims for ExtraClaims {}

/// Type alias for the discovered client *without* a fixed redirect URI.
type DiscoveredClient = openidconnect::core::CoreClient<
    EndpointSet,                   // HasAuthUrl
    openidconnect::EndpointNotSet, // HasDeviceAuthUrl
    openidconnect::EndpointNotSet, // HasIntrospectionUrl
    openidconnect::EndpointNotSet, // HasRevocationUrl
    EndpointMaybeSet,              // HasTokenUrl
    EndpointMaybeSet,              // HasUserInfoUrl
>;

/// Type alias for the discovered client *with* a fixed redirect URI.
type DiscoveredClientWithRedirect = openidconnect::core::CoreClient<
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
    client: DiscoveredClient,
    scopes: Vec<String>,
    /// The configured `redirect_uri` value (may be relative like `/auth/callback`).
    redirect_uri_template: String,
    /// When true, authorize_url and exchange_code use PKCE (code_challenge / code_verifier).
    pkce_enabled: bool,
}

impl OidcClient {
    /// Initialize the OIDC client from config.
    ///
    /// When `well_known_url` is set: fetch discovery from that URL, then override any
    /// endpoint URLs provided in config. When `well_known_url` is not set: use
    /// `issuer_url` and the four required endpoints (authorization, token, userinfo, jwks_uri).
    ///
    /// The redirect URI is **not** baked in here; call [`authorize_url`] or
    /// [`exchange_code`] with the resolved `external_base_url` at request time.
    pub async fn new(config: &OidcConfig) -> Result<Self> {
        let client_id = ClientId::new(config.client_id.clone());
        let client_secret = config
            .client_secret
            .as_ref()
            .map(|s| ClientSecret::new(s.clone()));

        let http_client = reqwest::Client::builder()
            .build()
            .map_err(|e| Error::OidcDiscovery {
                message: format!("Failed to build HTTP client: {e}"),
            })?;

        let metadata = if let Some(ref well_known_url) = config.well_known_url {
            Self::fetch_and_merge_metadata(config, well_known_url, &http_client).await?
        } else {
            Self::build_metadata_manual(config).await?
        };

        let jwks = JsonWebKeySet::fetch_async(metadata.jwks_uri(), &http_client)
            .await
            .map_err(|e| Error::OidcDiscovery {
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
            redirect_uri_template: config.redirect_uri.clone(),
            pkce_enabled: config.pkce_enabled,
        })
    }

    /// Fetch discovery from well_known_url, then apply config overrides for endpoints.
    async fn fetch_and_merge_metadata(
        config: &OidcConfig,
        well_known_url: &str,
        http_client: &reqwest::Client,
    ) -> Result<CoreProviderMetadata> {
        let body = http_client
            .get(well_known_url)
            .send()
            .await
            .map_err(|e| Error::OidcDiscovery {
                message: format!("Failed to fetch discovery document: {e}"),
            })?
            .bytes()
            .await
            .map_err(|e| Error::OidcDiscovery {
                message: format!("Failed to read discovery response: {e}"),
            })?;

        let mut metadata: CoreProviderMetadata =
            serde_json::from_slice(&body).map_err(|e| Error::OidcDiscovery {
                message: format!("Failed to parse discovery document: {e}"),
            })?;

        if let Some(issuer_url) = config.issuer_url.as_ref() {
            let issuer_url =
                IssuerUrl::new(issuer_url.clone()).map_err(|e| Error::OidcDiscovery {
                    message: format!("Invalid issuer_url: {e}"),
                })?;
            metadata = metadata.set_issuer(issuer_url);
        }

        if let Some(authorization_endpoint) = config.authorization_endpoint.as_ref() {
            let authorization_endpoint =
                AuthUrl::new(authorization_endpoint.clone()).map_err(|e| Error::OidcDiscovery {
                    message: format!("Invalid authorization_endpoint: {e}"),
                })?;
            metadata = metadata.set_authorization_endpoint(authorization_endpoint);
        }

        if let Some(token_endpoint) = config.token_endpoint.as_ref() {
            let token_endpoint =
                TokenUrl::new(token_endpoint.clone()).map_err(|e| Error::OidcDiscovery {
                    message: format!("Invalid token_endpoint: {e}"),
                })?;
            metadata = metadata.set_token_endpoint(Some(token_endpoint));
        }

        if let Some(userinfo_endpoint) = config.userinfo_endpoint.as_ref() {
            let userinfo_endpoint =
                UserInfoUrl::new(userinfo_endpoint.clone()).map_err(|e| Error::OidcDiscovery {
                    message: format!("Invalid userinfo_endpoint: {e}"),
                })?;
            metadata = metadata.set_userinfo_endpoint(Some(userinfo_endpoint));
        }

        if let Some(jwks_uri) = config.jwks_uri.as_ref() {
            let jwks_uri =
                JsonWebKeySetUrl::new(jwks_uri.clone()).map_err(|e| Error::OidcDiscovery {
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

    /// Build provider metadata from required endpoints (no discovery).
    async fn build_metadata_manual(config: &OidcConfig) -> Result<CoreProviderMetadata> {
        let issuer_url = IssuerUrl::new(
            config.issuer_url.as_deref().unwrap_or_default().to_string(),
        )
        .map_err(|e| Error::OidcDiscovery {
            message: format!("Invalid issuer_url: {e}"),
        })?;
        let authorization_endpoint = AuthUrl::new(
            config
                .authorization_endpoint
                .as_deref()
                .unwrap_or_default()
                .to_string(),
        )
        .map_err(|e| Error::OidcDiscovery {
            message: format!("Invalid authorization_endpoint: {e}"),
        })?;
        let jwks_uri =
            JsonWebKeySetUrl::new(config.jwks_uri.as_deref().unwrap_or_default().to_string())
                .map_err(|e| Error::OidcDiscovery {
                    message: format!("Invalid jwks_uri: {e}"),
                })?;

        let token_url = TokenUrl::new(
            config
                .token_endpoint
                .as_deref()
                .unwrap_or_default()
                .to_string(),
        )
        .map_err(|e| Error::OidcDiscovery {
            message: format!("Invalid token_endpoint: {e}"),
        })?;
        let userinfo_url = UserInfoUrl::new(
            config
                .userinfo_endpoint
                .as_deref()
                .unwrap_or_default()
                .to_string(),
        )
        .map_err(|e| Error::OidcDiscovery {
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

    /// Build the absolute redirect URL from the template and the resolved base URL.
    fn resolve_redirect_url(&self, external_base_url: &str) -> Result<String> {
        if self.redirect_uri_template.starts_with("http") {
            Ok(self.redirect_uri_template.clone())
        } else {
            Ok(format!(
                "{}{}",
                external_base_url.trim_end_matches('/'),
                self.redirect_uri_template
            ))
        }
    }

    /// Return a clone of the inner client with the given redirect URI set.
    fn client_with_redirect(
        &self,
        external_base_url: &str,
    ) -> Result<DiscoveredClientWithRedirect> {
        let url = self.resolve_redirect_url(external_base_url)?;
        let redirect_url = RedirectUrl::new(url).map_err(|e| Error::OidcDiscovery {
            message: format!("Invalid redirect URL: {e}"),
        })?;
        Ok(self.client.clone().set_redirect_uri(redirect_url))
    }

    /// Generate the authorization URL the user should be redirected to.
    ///
    /// When `pkce_enabled` (config), the fourth element is the PKCE code_verifier secret to store
    /// and pass to `exchange_code` in the callback.
    pub fn authorize_url(
        &self,
        external_base_url: &str,
    ) -> Result<(String, CsrfToken, Nonce, Option<String>)> {
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
    /// `external_base_url` must match the one used during [`authorize_url`] so
    /// that the redirect URI sent to the token endpoint is identical.
    pub async fn exchange_code(
        &self,
        code: &str,
        _nonce: &Nonce,
        external_base_url: &str,
        pkce_verifier_secret: Option<&str>,
    ) -> Result<serde_json::Value> {
        let client = self.client_with_redirect(external_base_url)?;

        let http_client =
            reqwest::Client::builder()
                .build()
                .map_err(|e| Error::OidcTokenExchange {
                    message: format!("Failed to build HTTP client: {e}"),
                })?;

        let mut token_request = client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .map_err(|e| Error::OidcTokenExchange {
                message: format!("Token endpoint not set or config error: {e}"),
            })?;
        if let Some(secret) = pkce_verifier_secret {
            token_request =
                token_request.set_pkce_verifier(PkceCodeVerifier::new(secret.to_string()));
        }

        let token_response = token_request
            .request_async(&http_client)
            .await
            .map_err(|e| Error::OidcTokenExchange {
                message: format!("Token exchange failed: {e}"),
            })?;

        // Try to get userinfo
        let userinfo_claims: UserInfoClaims<ExtraClaims, CoreGenderClaim> = client
            .user_info(token_response.access_token().clone(), None)
            .map_err(|e| Error::OidcClaims {
                message: format!("UserInfo request configuration failed: {e}"),
            })?
            .request_async(&http_client)
            .await
            .map_err(|e| Error::OidcClaims {
                message: format!("UserInfo request failed: {e}"),
            })?;

        // Convert claims to a JSON value for flexible processing
        let claims_value =
            serde_json::to_value(&userinfo_claims).map_err(|e| Error::OidcClaims {
                message: format!("Failed to serialize claims: {e}"),
            })?;

        Ok(claims_value)
    }
}
