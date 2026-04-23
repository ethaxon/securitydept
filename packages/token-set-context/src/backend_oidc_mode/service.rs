use securitydept_oidc_client::{OidcClient, OidcCodeCallbackSearchParams, PendingOauthStore};
use securitydept_utils::{
    http::HttpResponse,
    observability::{
        AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowDiagnosisOutcome, AuthFlowOperation,
        DiagnosedResult,
    },
};
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

fn backend_oidc_login_diagnosis(
    callback_path: &str,
    external_base_url: &Url,
    query: &BackendOidcModeAuthorizeQuery,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::OIDC_AUTHORIZE)
        .field(AuthFlowDiagnosisField::MODE, "backend_oidc")
        .field(AuthFlowDiagnosisField::CALLBACK_PATH, callback_path)
        .field(
            AuthFlowDiagnosisField::EXTERNAL_BASE_URL,
            external_base_url.as_str(),
        )
        .field(
            AuthFlowDiagnosisField::POST_AUTH_REDIRECT_PRESENT,
            query.post_auth_redirect_uri.is_some(),
        )
}

fn backend_oidc_callback_diagnosis(
    callback_path: &str,
    external_base_url: &Url,
    search_params: &OidcCodeCallbackSearchParams,
    response_transport: &str,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::OIDC_CALLBACK)
        .field(AuthFlowDiagnosisField::MODE, "backend_oidc")
        .field(
            AuthFlowDiagnosisField::RESPONSE_TRANSPORT,
            response_transport,
        )
        .field(AuthFlowDiagnosisField::CALLBACK_PATH, callback_path)
        .field(
            AuthFlowDiagnosisField::EXTERNAL_BASE_URL,
            external_base_url.as_str(),
        )
        .field(
            AuthFlowDiagnosisField::HAS_STATE,
            search_params.state.is_some(),
        )
        .field(
            AuthFlowDiagnosisField::HAS_CODE,
            !search_params.code.is_empty(),
        )
}

fn backend_oidc_refresh_diagnosis(
    callback_path: &str,
    external_base_url: &Url,
    payload: &BackendOidcModeRefreshPayload,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::OIDC_TOKEN_REFRESH)
        .field(AuthFlowDiagnosisField::MODE, "backend_oidc")
        .field(AuthFlowDiagnosisField::RESPONSE_TRANSPORT, "json_body")
        .field(AuthFlowDiagnosisField::CALLBACK_PATH, callback_path)
        .field(
            AuthFlowDiagnosisField::EXTERNAL_BASE_URL,
            external_base_url.as_str(),
        )
        .field(
            AuthFlowDiagnosisField::HAS_POST_AUTH_REDIRECT_URI,
            payload.post_auth_redirect_uri.is_some(),
        )
        .field(
            AuthFlowDiagnosisField::HAS_ID_TOKEN,
            payload.id_token.is_some(),
        )
}

fn backend_oidc_metadata_redeem_diagnosis(
    payload: &BackendOidcModeMetadataRedemptionRequest,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::OIDC_METADATA_REDEEM)
        .field(AuthFlowDiagnosisField::MODE, "backend_oidc")
        .field(
            AuthFlowDiagnosisField::METADATA_ID_PRESENT,
            !payload.metadata_redemption_id.expose().is_empty(),
        )
}

fn backend_oidc_user_info_diagnosis(access_token_present: bool) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(AuthFlowOperation::OIDC_USER_INFO)
        .field(AuthFlowDiagnosisField::MODE, "backend_oidc")
        .field(
            AuthFlowDiagnosisField::ACCESS_TOKEN_PRESENT,
            access_token_present,
        )
}

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
/// | [`callback_body_return`](Self::callback_body_return) | callback → JSON body (for programmatic flows) |
/// | [`refresh`](Self::refresh) | Refresh tokens → typed result |
/// | [`refresh_fragment_return`](Self::refresh_fragment_return) | refresh → 302 fragment redirect |
/// | [`refresh_body_return`](Self::refresh_body_return) | refresh → JSON body (for silent/programmatic refresh) |
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

    pub async fn login_with_diagnosis(
        &self,
        external_base_url: &Url,
        query: &BackendOidcModeAuthorizeQuery,
    ) -> DiagnosedResult<HttpResponse, BackendOidcModeRuntimeError> {
        let diagnosis = backend_oidc_login_diagnosis(self.callback_path, external_base_url, query);

        match self.login(external_base_url, query).await {
            Ok(response) => DiagnosedResult::success(
                diagnosis.with_outcome(AuthFlowDiagnosisOutcome::Succeeded),
                response,
            ),
            Err(error) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::FAILURE_STAGE, "backend_authorize"),
                error,
            ),
        }
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

    pub async fn callback_fragment_return_with_diagnosis(
        &self,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
        caller_post_auth_redirect_uri: Option<&Url>,
    ) -> DiagnosedResult<HttpResponse, BackendOidcModeRuntimeError> {
        let diagnosis = backend_oidc_callback_diagnosis(
            self.callback_path,
            external_base_url,
            &search_params,
            "fragment_redirect",
        );

        match self
            .callback_fragment_return(
                external_base_url,
                search_params,
                caller_post_auth_redirect_uri,
            )
            .await
        {
            Ok(response) => DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field(
                        AuthFlowDiagnosisField::HAS_POST_AUTH_REDIRECT_URI,
                        caller_post_auth_redirect_uri.is_some(),
                    ),
                response,
            ),
            Err(error) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(
                        AuthFlowDiagnosisField::FAILURE_STAGE,
                        "backend_callback_fragment_return",
                    ),
                error,
            ),
        }
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
        let qs = result.response_body.to_fragment_query_string();

        let redirect_url = pick_redirect_uri(
            result.post_auth_redirect_uri.as_ref(),
            caller_post_auth_redirect_uri,
        )?;
        let mut url = redirect_url.clone();
        url.set_fragment(Some(&qs));
        Ok(HttpResponse::found(url.as_str()))
    }

    /// Handle the OIDC code callback and return token material + inline
    /// metadata as a JSON response body (200 OK).
    ///
    /// Unlike [`callback_fragment_return`](Self::callback_fragment_return) this
    /// method uses the inline runtime path:
    ///
    /// - **No** `post_auth_redirect_uri` resolution (irrelevant for body flows)
    /// - **No** metadata store write — `AuthStateMetadataSnapshot` is embedded
    ///   directly in the response body under the `metadata` key
    ///
    /// This avoids one store write and one client redemption round-trip,
    /// making it the preferred handler for programmatic callback flows.
    pub async fn callback_body_return(
        &self,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
    ) -> Result<serde_json::Value, BackendOidcModeRuntimeError> {
        let result = self
            .runtime
            .handle_code_callback_inline(
                self.oidc_client,
                search_params,
                external_base_url,
                &self.auth_state_options,
                None,
            )
            .await?;
        Ok(result.response_body.to_response_body())
    }

    pub async fn callback_body_return_with_diagnosis(
        &self,
        external_base_url: &Url,
        search_params: OidcCodeCallbackSearchParams,
    ) -> DiagnosedResult<serde_json::Value, BackendOidcModeRuntimeError> {
        let diagnosis = backend_oidc_callback_diagnosis(
            self.callback_path,
            external_base_url,
            &search_params,
            "json_body",
        );

        match self
            .callback_body_return(external_base_url, search_params)
            .await
        {
            Ok(body) => DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field(
                        AuthFlowDiagnosisField::HAS_METADATA,
                        body.get("metadata").is_some(),
                    ),
                body,
            ),
            Err(error) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(
                        AuthFlowDiagnosisField::FAILURE_STAGE,
                        "backend_callback_body_return",
                    ),
                error,
            ),
        }
    }

    // -----------------------------------------------------------------------
    // Refresh
    // -----------------------------------------------------------------------

    /// Refresh tokens. Returns a typed result.
    pub async fn refresh(
        &self,
        payload: &BackendOidcModeRefreshPayload,
        external_base_url: &Url,
    ) -> Result<BackendOidcModeTokenRefreshResult, BackendOidcModeRuntimeError> {
        self.runtime
            .handle_token_refresh(self.oidc_client, payload, external_base_url)
            .await
    }

    /// Refresh tokens and redirect with the delta in the URL fragment.
    ///
    /// Suitable for browser navigation flows. For programmatic/silent refresh
    /// via `fetch()`, use [`refresh_body_return`](Self::refresh_body_return).
    pub async fn refresh_fragment_return(
        &self,
        payload: &BackendOidcModeRefreshPayload,
        caller_post_auth_redirect_uri: Option<&Url>,
        external_base_url: &Url,
    ) -> Result<HttpResponse, BackendOidcModeRuntimeError> {
        let result = self.refresh(payload, external_base_url).await?;
        let qs = result.response_body.to_fragment_query_string();

        let redirect_url = pick_redirect_uri(
            result.post_auth_redirect_uri.as_ref(),
            caller_post_auth_redirect_uri,
        )?;
        let mut url = redirect_url.clone();
        url.set_fragment(Some(&qs));
        Ok(HttpResponse::found(url.as_str()))
    }

    /// Refresh tokens and return token delta + inline metadata as a JSON
    /// response body (200 OK).
    ///
    /// Unlike [`refresh_fragment_return`](Self::refresh_fragment_return) this
    /// method uses the inline runtime path:
    ///
    /// - **No** `post_auth_redirect_uri` resolution (irrelevant for body flows)
    /// - **No** metadata store write — `AuthStateMetadataDelta` is embedded
    ///   directly in the response body under the `metadata` key
    ///
    /// This avoids one store write and one client redemption round-trip,
    /// making it the preferred handler for silent/programmatic refresh via
    /// `fetch()`.
    pub async fn refresh_body_return(
        &self,
        payload: &BackendOidcModeRefreshPayload,
    ) -> Result<serde_json::Value, BackendOidcModeRuntimeError> {
        let result = self
            .runtime
            .handle_token_refresh_inline(self.oidc_client, payload)
            .await?;
        Ok(result.response_body.to_response_body())
    }

    pub async fn refresh_body_return_with_diagnosis(
        &self,
        payload: &BackendOidcModeRefreshPayload,
        external_base_url: &Url,
    ) -> DiagnosedResult<serde_json::Value, BackendOidcModeRuntimeError> {
        let diagnosis =
            backend_oidc_refresh_diagnosis(self.callback_path, external_base_url, payload);

        match self.refresh_body_return(payload).await {
            Ok(body) => DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field(
                        AuthFlowDiagnosisField::HAS_METADATA,
                        body.get("metadata").is_some(),
                    ),
                body,
            ),
            Err(error) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(
                        AuthFlowDiagnosisField::FAILURE_STAGE,
                        "backend_refresh_body_return",
                    ),
                error,
            ),
        }
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

    pub async fn redeem_metadata_with_diagnosis(
        &self,
        payload: &BackendOidcModeMetadataRedemptionRequest,
    ) -> DiagnosedResult<
        Option<BackendOidcModeMetadataRedemptionResponse>,
        BackendOidcModeRuntimeError,
    > {
        let diagnosis = backend_oidc_metadata_redeem_diagnosis(payload);

        match self.redeem_metadata(payload).await {
            Ok(metadata) => DiagnosedResult::success(
                diagnosis
                    .with_outcome(if metadata.is_some() {
                        AuthFlowDiagnosisOutcome::Succeeded
                    } else {
                        AuthFlowDiagnosisOutcome::Rejected
                    })
                    .field(
                        AuthFlowDiagnosisField::METADATA_REDEEMED,
                        metadata.is_some(),
                    ),
                metadata,
            ),
            Err(error) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::METADATA_REDEEMED, false)
                    .field(AuthFlowDiagnosisField::FAILURE_STAGE, "metadata_redemption"),
                error,
            ),
        }
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

        Ok(result.into())
    }

    pub async fn user_info_with_diagnosis(
        &self,
        request: &BackendOidcModeUserInfoRequest,
        access_token: &str,
    ) -> DiagnosedResult<BackendOidcModeUserInfoResponse, BackendOidcModeRuntimeError> {
        let diagnosis = backend_oidc_user_info_diagnosis(true);

        match self.user_info(request, access_token).await {
            Ok(response) => DiagnosedResult::success(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
                    .field(AuthFlowDiagnosisField::SUBJECT, response.subject.clone()),
                response,
            ),
            Err(error) => DiagnosedResult::failure(
                diagnosis
                    .with_outcome(AuthFlowDiagnosisOutcome::Failed)
                    .field(AuthFlowDiagnosisField::FAILURE_STAGE, "user_info_exchange"),
                error,
            ),
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend_oidc_mode::metadata_redemption::MetadataRedemptionId;

    #[test]
    fn backend_oidc_login_diagnosis_reports_redirect_presence() {
        let diagnosis = backend_oidc_login_diagnosis(
            "/auth/token-set/backend-mode/callback",
            &Url::parse("https://auth.example.com").expect("url should parse"),
            &BackendOidcModeAuthorizeQuery {
                post_auth_redirect_uri: Some("/app".to_string()),
            },
        );

        assert_eq!(diagnosis.operation, AuthFlowOperation::OIDC_AUTHORIZE);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::MODE],
            "backend_oidc"
        );
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::POST_AUTH_REDIRECT_PRESENT],
            true
        );
    }

    #[test]
    fn backend_oidc_metadata_redeem_diagnosis_reports_metadata_identifier_presence() {
        let diagnosis =
            backend_oidc_metadata_redeem_diagnosis(&BackendOidcModeMetadataRedemptionRequest {
                metadata_redemption_id: MetadataRedemptionId::new("meta-1"),
            })
            .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
            .field(AuthFlowDiagnosisField::METADATA_REDEEMED, false);

        assert_eq!(diagnosis.operation, AuthFlowOperation::OIDC_METADATA_REDEEM);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::METADATA_ID_PRESENT],
            true
        );
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::METADATA_REDEEMED],
            false
        );
    }

    #[test]
    fn backend_oidc_user_info_diagnosis_marks_missing_access_token_as_rejected() {
        let diagnosis = backend_oidc_user_info_diagnosis(false)
            .with_outcome(AuthFlowDiagnosisOutcome::Rejected)
            .field(AuthFlowDiagnosisField::REASON, "missing_access_token");

        assert_eq!(diagnosis.operation, AuthFlowOperation::OIDC_USER_INFO);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::ACCESS_TOKEN_PRESENT],
            false
        );
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::REASON],
            "missing_access_token"
        );
    }
}
