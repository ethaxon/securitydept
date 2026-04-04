use securitydept_oidc_client::{OidcClient, OidcCodeCallbackSearchParams, PendingOauthStore};
use securitydept_utils::http::HttpResponse;
use url::Url;

use super::{
    BackendOidcMediatedModeRuntime, MetadataRedemptionRequest, MetadataRedemptionResponse,
    OidcAuthStateOptions, PendingAuthStateMetadataRedemptionStore, TokenRefreshPayload,
    TokenSetAuthorizeQuery, error::BackendOidcMediatedModeRuntimeError,
};

/// Route-facing auth service for `backend-oidc-mediated` mode.
///
/// Orchestrates OIDC authorization code flow, token refresh, and metadata
/// redemption against a [`BackendOidcMediatedModeRuntime`].
#[derive(Clone, Copy)]
pub struct BackendOidcMediatedModeAuthService<'a, PS, MS>
where
    PS: PendingOauthStore,
    MS: PendingAuthStateMetadataRedemptionStore,
{
    oidc_client: &'a OidcClient<PS>,
    mediated_runtime: &'a BackendOidcMediatedModeRuntime<MS>,
    callback_path: &'a str,
}

impl<'a, P, M> BackendOidcMediatedModeAuthService<'a, P, M>
where
    P: PendingOauthStore,
    M: PendingAuthStateMetadataRedemptionStore,
{
    pub fn new(
        oidc_client: &'a OidcClient<P>,
        mediated_runtime: &'a BackendOidcMediatedModeRuntime<M>,
        callback_path: &'a str,
    ) -> Self {
        Self {
            oidc_client,
            mediated_runtime,
            callback_path,
        }
    }

    pub async fn login(
        &self,
        external_base_url: &Url,
        query: &TokenSetAuthorizeQuery,
    ) -> Result<HttpResponse, BackendOidcMediatedModeRuntimeError> {
        let authorization_request = self
            .mediated_runtime
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
    ) -> Result<HttpResponse, BackendOidcMediatedModeRuntimeError> {
        let coordination_result = self
            .mediated_runtime
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
    ) -> Result<HttpResponse, BackendOidcMediatedModeRuntimeError> {
        let coordination_result = self
            .mediated_runtime
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
    ) -> Result<Option<MetadataRedemptionResponse>, BackendOidcMediatedModeRuntimeError> {
        self.mediated_runtime.redeem_metadata(payload).await
    }
}
