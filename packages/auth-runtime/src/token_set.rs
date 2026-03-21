use axum::{
    Json,
    response::{IntoResponse, Redirect, Response},
};
use securitydept_oidc_client::{OidcClient, OidcCodeCallbackSearchParams, PendingOauthStore};
use securitydept_token_set_context::{
    MetadataRedemptionRequest, OidcAuthStateOptions, PendingAuthStateMetadataRedemptionStore,
    TokenRefreshPayload, TokenSetAuthorizeQuery, TokenSetContext,
};
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
    ) -> Result<Response, AuthRuntimeError> {
        let authorization_request = self
            .token_set_context
            .authorize_code_flow(
                self.oidc_client,
                external_base_url,
                query.redirect_uri.as_deref(),
                Some(self.callback_path),
            )
            .await?;

        Ok(Redirect::temporary(authorization_request.authorization_url.as_str()).into_response())
    }

    pub async fn callback(
        &self,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
    ) -> Result<Response, AuthRuntimeError> {
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
        let mut token_set_redirect_uri = coordination_result.token_set_redirect_uri;
        let fragment = coordination_result.redirect_fragment.to_fragment();

        token_set_redirect_uri.set_fragment(Some(&fragment));
        Ok(Redirect::to(token_set_redirect_uri.as_str()).into_response())
    }

    pub async fn refresh(
        &self,
        payload: &TokenRefreshPayload,
    ) -> Result<Response, AuthRuntimeError> {
        let coordination_result = self
            .token_set_context
            .refresh_from_payload_with_metadata_store(self.oidc_client, payload)
            .await?;
        let mut redirect_uri = coordination_result.redirect_uri;
        let fragment = coordination_result.redirect_fragment.to_fragment();

        redirect_uri.set_fragment(Some(&fragment));
        Ok(Redirect::to(redirect_uri.as_str()).into_response())
    }

    pub async fn redeem_metadata(
        &self,
        payload: &MetadataRedemptionRequest,
    ) -> Result<Response, AuthRuntimeError> {
        let metadata = self.token_set_context.redeem_metadata(payload).await?;

        match metadata {
            Some(metadata) => Ok(Json(metadata).into_response()),
            None => Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        }
    }
}
