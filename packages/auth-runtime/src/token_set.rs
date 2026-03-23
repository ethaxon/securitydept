use securitydept_creds::{CoreJwtClaims, parse_bearer_auth_header_opt};
use securitydept_oauth_resource_server::{OAuthResourceServerVerifier, ResourceTokenPrincipal};
use securitydept_oidc_client::{OidcClient, OidcCodeCallbackSearchParams, PendingOauthStore};
use securitydept_token_set_context::{
    MetadataRedemptionRequest, MetadataRedemptionResponse, OidcAuthStateOptions,
    PendingAuthStateMetadataRedemptionStore, TokenRefreshPayload, TokenSetAuthorizeQuery,
    TokenSetContext,
};
use securitydept_utils::http::HttpResponse;
use url::Url;

use crate::AuthRuntimeError;

#[derive(Clone, Copy)]
pub struct TokenSetAuthService<'a, PS, MS>
where
    PS: PendingOauthStore,
    MS: PendingAuthStateMetadataRedemptionStore,
{
    oidc_client: &'a OidcClient<PS>,
    token_set_context: &'a TokenSetContext<MS>,
    callback_path: &'a str,
}

impl<'a, P, M> TokenSetAuthService<'a, P, M>
where
    P: PendingOauthStore,
    M: PendingAuthStateMetadataRedemptionStore,
{
    pub fn new(
        oidc_client: &'a OidcClient<P>,
        token_set_context: &'a TokenSetContext<M>,
        callback_path: &'a str,
    ) -> Self {
        Self {
            oidc_client,
            token_set_context,
            callback_path,
        }
    }

    pub async fn login(
        &self,
        external_base_url: &Url,
        query: &TokenSetAuthorizeQuery,
    ) -> Result<HttpResponse, AuthRuntimeError> {
        let authorization_request = self
            .token_set_context
            .authorize_code_flow(
                self.oidc_client,
                external_base_url,
                query.post_auth_redirect_uri.as_deref(),
                Some(self.callback_path),
            )
            .await?;

        Ok(HttpResponse::temporary_redirect(
            authorization_request.authorization_url.as_str(),
        ))
    }

    pub async fn callback(
        &self,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
    ) -> Result<HttpResponse, AuthRuntimeError> {
        let coordination_result = self
            .token_set_context
            .handle_code_callback_with_metadata_store(
                self.oidc_client,
                search_params,
                external_base_url,
                &OidcAuthStateOptions::default(),
                Some(self.callback_path),
            )
            .await?;
        let mut post_auth_redirect_uri = coordination_result.post_auth_redirect_uri;
        let fragment = coordination_result.redirect_fragment.to_fragment();

        post_auth_redirect_uri.set_fragment(Some(&fragment));
        Ok(HttpResponse::found(post_auth_redirect_uri.as_str()))
    }

    pub async fn refresh(
        &self,
        payload: &TokenRefreshPayload,
    ) -> Result<HttpResponse, AuthRuntimeError> {
        let coordination_result = self
            .token_set_context
            .refresh_from_payload_with_metadata_store(self.oidc_client, payload)
            .await?;
        let mut post_auth_redirect_uri = coordination_result.post_auth_redirect_uri;
        let fragment = coordination_result.redirect_fragment.to_fragment();

        post_auth_redirect_uri.set_fragment(Some(&fragment));
        Ok(HttpResponse::found(post_auth_redirect_uri.as_str()))
    }

    pub async fn redeem_metadata(
        &self,
        payload: &MetadataRedemptionRequest,
    ) -> Result<Option<MetadataRedemptionResponse>, AuthRuntimeError> {
        self.token_set_context
            .redeem_metadata(payload)
            .await
            .map_err(|source| AuthRuntimeError::TokenSetContext { source })
    }
}

pub type TokenSetResourcePrincipal = ResourceTokenPrincipal;

#[derive(Clone, Copy)]
pub struct TokenSetResourceService<'a> {
    verifier: &'a OAuthResourceServerVerifier,
}

impl<'a> TokenSetResourceService<'a> {
    pub fn new(verifier: &'a OAuthResourceServerVerifier) -> Self {
        Self { verifier }
    }

    pub async fn authenticate_authorization_header(
        &self,
        authorization_header: Option<&str>,
    ) -> Result<Option<TokenSetResourcePrincipal>, AuthRuntimeError> {
        let Some(authorization_header) = authorization_header else {
            return Ok(None);
        };
        let Some(token) = parse_bearer_auth_header_opt(authorization_header) else {
            return Ok(None);
        };

        let verified = self
            .verifier
            .verify_token::<CoreJwtClaims>(&token)
            .await
            .map_err(|source| AuthRuntimeError::OAuthResourceServer { source })?;

        Ok(Some(verified.to_resource_token_principal()))
    }
}
