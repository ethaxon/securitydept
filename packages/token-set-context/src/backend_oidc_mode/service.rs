use securitydept_oidc_client::{OidcClient, OidcCodeCallbackSearchParams, PendingOauthStore};
use securitydept_utils::http::HttpResponse;
use url::Url;

use super::{
    metadata_redemption::PendingAuthStateMetadataRedemptionStore,
    runtime::{
        BackendOidcModeAuthStateOptions, BackendOidcModeCodeCallbackResult, BackendOidcModeRuntime,
        BackendOidcModeRuntimeError, BackendOidcModeTokenRefreshResult,
    },
    transport::{
        BackendOidcModeAuthorizeQuery, BackendOidcModeMetadataRedemptionRequest,
        BackendOidcModeMetadataRedemptionResponse, BackendOidcModeRefreshPayload,
        BackendOidcModeUserInfoRequest, BackendOidcModeUserInfoResponse,
    },
};

/// Unified route-facing auth service for `backend-oidc` mode.
///
/// Orchestrates OIDC authorization code flow, code callback, token refresh,
/// metadata redemption, and user-info exchange. The service is parameterized
/// by capability axes through the underlying [`BackendOidcModeRuntime`]:
///
/// - `refresh_material_protection`: passthrough vs sealed
/// - `metadata_delivery`: none vs redemption
/// - `post_auth_redirect_policy`: caller_validated vs resolved
///
/// # Service pattern
///
/// Each flow verb (`callback`, `refresh`) returns a typed result.
/// The browser-facing fragment redirect is produced by an explicit companion
/// helper (`callback_fragment_return`, `refresh_fragment_return`).
///
/// | Method | Description |
/// |---|---|
/// | [`login`](Self::login) | Initiate OIDC authorization code flow → redirect |
/// | [`callback`](Self::callback) | Handle OIDC code callback → typed result |
/// | [`callback_fragment_return`](Self::callback_fragment_return) | callback → 302 fragment redirect |
/// | [`refresh`](Self::refresh) | Refresh tokens → typed result |
/// | [`refresh_fragment_return`](Self::refresh_fragment_return) | refresh → 302 fragment redirect |
/// | [`redeem_metadata`](Self::redeem_metadata) | Redeem one-time metadata (if `metadata_delivery = redemption`) |
/// | [`user_info`](Self::user_info) | User info exchange |
#[derive(Clone)]
pub struct BackendOidcModeAuthService<'a, PS, MS>
where
    PS: PendingOauthStore,
    MS: PendingAuthStateMetadataRedemptionStore,
{
    oidc_client: &'a OidcClient<PS>,
    runtime: &'a BackendOidcModeRuntime<MS>,
    callback_path: &'a str,
    auth_state_options: BackendOidcModeAuthStateOptions,
}

impl<'a, PS, MS> BackendOidcModeAuthService<'a, PS, MS>
where
    PS: PendingOauthStore,
    MS: PendingAuthStateMetadataRedemptionStore,
{
    pub fn new(
        oidc_client: &'a OidcClient<PS>,
        runtime: &'a BackendOidcModeRuntime<MS>,
        callback_path: &'a str,
    ) -> Self {
        Self {
            oidc_client,
            runtime,
            callback_path,
            auth_state_options: BackendOidcModeAuthStateOptions::default(),
        }
    }

    pub fn with_auth_state_options(mut self, options: BackendOidcModeAuthStateOptions) -> Self {
        self.auth_state_options = options;
        self
    }

    // -----------------------------------------------------------------------
    // Login
    // -----------------------------------------------------------------------

    /// Initiate the OIDC authorization code flow.
    ///
    /// Produces an HTTP 307 redirect to the provider's authorization endpoint.
    pub async fn login(
        &self,
        external_base_url: &Url,
        query: &BackendOidcModeAuthorizeQuery,
    ) -> Result<HttpResponse, BackendOidcModeRuntimeError> {
        let authorization_request = self
            .runtime
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

    // -----------------------------------------------------------------------
    // Callback
    // -----------------------------------------------------------------------

    /// Handle the OIDC code callback. Returns a typed result.
    pub async fn callback(
        &self,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
    ) -> Result<BackendOidcModeCodeCallbackResult, BackendOidcModeRuntimeError> {
        self.runtime
            .handle_code_callback(
                self.oidc_client,
                search_params,
                external_base_url,
                &self.auth_state_options,
                Some(self.callback_path),
            )
            .await
    }

    /// Handle the OIDC code callback and redirect with the token set in
    /// the URL fragment.
    ///
    /// When `post_auth_redirect_policy = resolved`, the redirect URI is
    /// supplied by the runtime's resolver. When `caller_validated`, the
    /// caller must supply `post_auth_redirect_uri`.
    pub async fn callback_fragment_return(
        &self,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
        caller_post_auth_redirect_uri: Option<&Url>,
    ) -> Result<HttpResponse, BackendOidcModeRuntimeError> {
        let result = self.callback(external_base_url, search_params).await?;
        let qs = result.redirect_fragment.to_fragment_query_string();

        let redirect_url = pick_redirect_uri(
            result.post_auth_redirect_uri.as_ref(),
            caller_post_auth_redirect_uri,
        )?;
        let mut url = redirect_url.clone();
        url.set_fragment(Some(&qs));
        Ok(HttpResponse::found(url.as_str()))
    }

    // -----------------------------------------------------------------------
    // Refresh
    // -----------------------------------------------------------------------

    /// Refresh tokens. Returns a typed result.
    pub async fn refresh(
        &self,
        payload: &BackendOidcModeRefreshPayload,
    ) -> Result<BackendOidcModeTokenRefreshResult, BackendOidcModeRuntimeError> {
        self.runtime
            .handle_token_refresh(self.oidc_client, payload)
            .await
    }

    /// Refresh tokens and redirect with the delta in the URL fragment.
    pub async fn refresh_fragment_return(
        &self,
        payload: &BackendOidcModeRefreshPayload,
        caller_post_auth_redirect_uri: Option<&Url>,
    ) -> Result<HttpResponse, BackendOidcModeRuntimeError> {
        let result = self.refresh(payload).await?;
        let qs = result.redirect_fragment.to_fragment_query_string();

        let redirect_url = pick_redirect_uri(
            result.post_auth_redirect_uri.as_ref(),
            caller_post_auth_redirect_uri,
        )?;
        let mut url = redirect_url.clone();
        url.set_fragment(Some(&qs));
        Ok(HttpResponse::found(url.as_str()))
    }

    // -----------------------------------------------------------------------
    // Metadata redemption
    // -----------------------------------------------------------------------

    /// Redeem metadata by one-time redemption id.
    ///
    /// Only available when `metadata_delivery = redemption`.
    pub async fn redeem_metadata(
        &self,
        payload: &BackendOidcModeMetadataRedemptionRequest,
    ) -> Result<Option<BackendOidcModeMetadataRedemptionResponse>, BackendOidcModeRuntimeError>
    {
        self.runtime.redeem_metadata(payload).await
    }

    // -----------------------------------------------------------------------
    // User info
    // -----------------------------------------------------------------------

    /// Exchange an ID token + access token for normalized user information.
    ///
    /// Delegates to the shared `OidcClient::handle_user_info_exchange` helper.
    pub async fn user_info(
        &self,
        request: &BackendOidcModeUserInfoRequest,
        access_token: &str,
    ) -> Result<BackendOidcModeUserInfoResponse, BackendOidcModeRuntimeError> {
        let result = self
            .oidc_client
            .handle_user_info_exchange(&request.id_token, access_token)
            .await?;

        Ok(BackendOidcModeUserInfoResponse {
            subject: result.subject,
            display_name: result.display_name,
            picture: result.picture,
            issuer: result.issuer,
            claims: result.claims,
        })
    }

    /// Access the underlying OIDC client.
    pub fn oidc_client(&self) -> &OidcClient<PS> {
        self.oidc_client
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Pick the redirect URI from the runtime-resolved or caller-provided source.
fn pick_redirect_uri(
    runtime_resolved: Option<&Url>,
    caller_provided: Option<&Url>,
) -> Result<Url, BackendOidcModeRuntimeError> {
    runtime_resolved
        .or(caller_provided)
        .cloned()
        .ok_or_else(|| BackendOidcModeRuntimeError::Config {
            message: "no post_auth_redirect_uri available: either the runtime must resolve it \
                      (post_auth_redirect_policy = resolved) or the caller must supply it"
                .to_string(),
        })
}
