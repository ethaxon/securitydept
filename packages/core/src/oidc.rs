use openidconnect::core::{CoreGenderClaim, CoreProviderMetadata, CoreResponseType};
use openidconnect::{
    AdditionalClaims, AuthenticationFlow, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    EndpointMaybeSet, EndpointSet, IssuerUrl, Nonce, OAuth2TokenResponse, RedirectUrl, Scope,
    UserInfoClaims,
};
use serde::{Deserialize, Serialize};

use crate::config::OidcConfig;
use crate::error::{Error, Result};

/// Additional claims we accept from the OIDC provider (open-ended).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraClaims {
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

impl AdditionalClaims for ExtraClaims {}

/// Type alias for the full client type returned by `from_provider_metadata` + `set_redirect_uri`.
type DiscoveredClient = openidconnect::core::CoreClient<
    EndpointSet,         // HasAuthUrl
    openidconnect::EndpointNotSet, // HasDeviceAuthUrl
    openidconnect::EndpointNotSet, // HasIntrospectionUrl
    openidconnect::EndpointNotSet, // HasRevocationUrl
    EndpointMaybeSet,    // HasTokenUrl
    EndpointMaybeSet,    // HasUserInfoUrl
>;

/// Wraps the OIDC discovered client for login/callback flows.
pub struct OidcClient {
    client: DiscoveredClient,
    scopes: Vec<String>,
}

impl OidcClient {
    /// Initialize the OIDC client via discovery.
    pub async fn new(config: &OidcConfig, external_base_url: &str) -> Result<Self> {
        let client_id = ClientId::new(config.client_id.clone());
        let client_secret = config
            .client_secret
            .as_ref()
            .map(|s| ClientSecret::new(s.clone()));

        let redirect_url = if config.redirect_uri.starts_with("http") {
            config.redirect_uri.clone()
        } else {
            format!(
                "{}{}",
                external_base_url.trim_end_matches('/'),
                config.redirect_uri
            )
        };

        let redirect_url = RedirectUrl::new(redirect_url).map_err(|e| Error::OidcDiscovery {
            message: format!("Invalid redirect URL: {e}"),
        })?;

        let http_client =
            reqwest::Client::builder()
                .build()
                .map_err(|e| Error::OidcDiscovery {
                    message: format!("Failed to build HTTP client: {e}"),
                })?;

        if config.well_known_url.is_none() {
            return Err(Error::OidcDiscovery {
                message: "Manual endpoint configuration not yet implemented; please provide well_known_url".to_string(),
            });
        }

        let well_known = config.well_known_url.as_ref().unwrap();
        let issuer_url =
            IssuerUrl::new(well_known.clone()).map_err(|e| Error::OidcDiscovery {
                message: format!("Invalid issuer URL: {e}"),
            })?;

        let metadata: CoreProviderMetadata =
            CoreProviderMetadata::discover_async(issuer_url, &http_client)
                .await
                .map_err(|e| Error::OidcDiscovery {
                    message: format!("Discovery failed: {e}"),
                })?;

        // `from_provider_metadata` sets HasAuthUrl = EndpointSet,
        // HasTokenUrl = EndpointMaybeSet, HasUserInfoUrl = EndpointMaybeSet.
        // Then `set_redirect_uri` preserves the type.
        let client = openidconnect::core::CoreClient::from_provider_metadata(
            metadata,
            client_id,
            client_secret,
        )
        .set_redirect_uri(redirect_url);

        Ok(Self {
            client,
            scopes: config.scopes.clone(),
        })
    }

    /// Generate the authorization URL the user should be redirected to.
    pub fn authorize_url(&self) -> (String, CsrfToken, Nonce) {
        let mut req = self.client.authorize_url(
            AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        );

        for scope in &self.scopes {
            req = req.add_scope(Scope::new(scope.clone()));
        }

        let (url, csrf, nonce) = req.url();
        (url.to_string(), csrf, nonce)
    }

    /// Exchange the authorization code for tokens, then fetch user info claims.
    pub async fn exchange_code(
        &self,
        code: &str,
        _nonce: &Nonce,
    ) -> Result<serde_json::Value> {
        let http_client =
            reqwest::Client::builder()
                .build()
                .map_err(|e| Error::OidcTokenExchange {
                    message: format!("Failed to build HTTP client: {e}"),
                })?;

        let token_response = self
            .client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .expect("token endpoint must be set via discovery")
            .request_async(&http_client)
            .await
            .map_err(|e| Error::OidcTokenExchange {
                message: format!("Token exchange failed: {e}"),
            })?;

        // Try to get userinfo
        let userinfo_claims: UserInfoClaims<ExtraClaims, CoreGenderClaim> = self
            .client
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
        let claims_value = serde_json::to_value(&userinfo_claims).map_err(|e| {
            Error::OidcClaims {
                message: format!("Failed to serialize claims: {e}"),
            }
        })?;

        Ok(claims_value)
    }
}
