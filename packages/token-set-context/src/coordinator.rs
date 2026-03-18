use chrono::Utc;
use securitydept_oidc_client::{
    OidcClient, OidcCodeCallbackResult, OidcCodeCallbackSearchParams,
    OidcCodeFlowAuthorizationRequest, OidcError, PendingOauthStore,
};
use serde_json::json;
use snafu::Snafu;
use url::Url;

use crate::{
    AuthStateDelta, AuthStateMetadataDelta, AuthStateSnapshot, AuthTokenDelta,
    AuthTokenDeltaRedirectFragment, AuthTokenSnapshotRedirectFragment, OidcAuthStateOptions,
    PendingAuthStateMetadataRedemptionPayload, PendingAuthStateMetadataRedemptionStore,
    PendingAuthStateMetadataRedemptionStoreError, TokenRefreshPayload, TokenSetContext,
    TokenSetContextError,
};

const PENDING_REDIRECT_URI_KEY: &str = "redirect_uri";

#[derive(Debug, Snafu)]
pub enum AuthStateCoordinatorError {
    #[snafu(display("token-set context operation failed: {source}"))]
    TokenSetContext { source: TokenSetContextError },
    #[snafu(display("OIDC operation failed: {source}"))]
    Oidc { source: OidcError },
    #[snafu(display("metadata redemption operation failed: {source}"))]
    MetadataRedemption {
        source: PendingAuthStateMetadataRedemptionStoreError,
    },
}

#[derive(Debug, Clone)]
pub struct TokenRefreshCoordinationResult {
    pub redirect_uri: Url,
    pub updated_auth_state: Option<AuthStateSnapshot>,
    pub auth_state_delta: AuthStateDelta,
    pub redirect_fragment: AuthTokenDeltaRedirectFragment,
}

#[derive(Debug, Clone)]
pub struct CodeCallbackCoordinationResult {
    pub redirect_uri: Url,
    pub auth_state_snapshot: AuthStateSnapshot,
    pub redirect_fragment: AuthTokenSnapshotRedirectFragment,
}

#[derive(Clone, Copy)]
pub struct AuthStateCoordinator<'a> {
    token_set_context: &'a TokenSetContext,
    oidc_client: &'a OidcClient,
}

impl<'a> AuthStateCoordinator<'a> {
    pub fn new(token_set_context: &'a TokenSetContext, oidc_client: &'a OidcClient) -> Self {
        Self {
            token_set_context,
            oidc_client,
        }
    }

    pub async fn authorize_code_flow(
        &self,
        external_base_url: &Url,
        pending_oauth_store: &impl PendingOauthStore,
        requested_redirect_uri: Option<&str>,
        redirect_url_override: Option<&str>,
    ) -> Result<OidcCodeFlowAuthorizationRequest, AuthStateCoordinatorError> {
        let redirect_uri = self
            .token_set_context
            .resolve_redirect_uri(requested_redirect_uri)
            .map_err(|source| AuthStateCoordinatorError::TokenSetContext { source })?;

        self.oidc_client
            .handle_code_authorize_with_redirect_override_and_extra_data(
                external_base_url,
                pending_oauth_store,
                redirect_url_override,
                Some(json!({
                    PENDING_REDIRECT_URI_KEY: redirect_uri.as_str(),
                })),
            )
            .await
            .map_err(|source| AuthStateCoordinatorError::Oidc { source })
    }

    pub async fn refresh_from_payload(
        &self,
        payload: &TokenRefreshPayload,
    ) -> Result<TokenRefreshCoordinationResult, AuthStateCoordinatorError> {
        self.refresh_from_payload_with_metadata_store(payload, None)
            .await
    }

    pub async fn refresh_from_payload_with_metadata_store(
        &self,
        payload: &TokenRefreshPayload,
        metadata_store: Option<&dyn PendingAuthStateMetadataRedemptionStore>,
    ) -> Result<TokenRefreshCoordinationResult, AuthStateCoordinatorError> {
        let redirect_uri = self
            .token_set_context
            .resolve_redirect_uri(payload.redirect_uri.as_deref())
            .map_err(|source| AuthStateCoordinatorError::TokenSetContext { source })?;
        let refresh_token = self
            .token_set_context
            .unseal_refresh_token(&payload.refresh_material)
            .map_err(|source| AuthStateCoordinatorError::TokenSetContext { source })?;
        let refresh_result = self
            .oidc_client
            .handle_token_refresh(refresh_token)
            .await
            .map_err(|source| AuthStateCoordinatorError::Oidc { source })?;

        let updated_auth_state = payload
            .current_auth_state
            .as_ref()
            .map(|current| {
                self.token_set_context
                    .auth_state_snapshot_from_refresh_result(current, &refresh_result)
            })
            .transpose()
            .map_err(|source| AuthStateCoordinatorError::TokenSetContext { source })?;
        let refresh_material_delta = refresh_result
            .refresh_token
            .as_deref()
            .map(|value| self.token_set_context.seal_refresh_token(value))
            .transpose()
            .map_err(|source| AuthStateCoordinatorError::TokenSetContext { source })?;
        let token_delta = AuthTokenDelta {
            access_token: refresh_result.access_token.clone(),
            id_token: refresh_result.id_token.clone(),
            refresh_material: refresh_material_delta,
            access_token_expires_at: refresh_result.access_token_expiration,
        };
        let metadata_delta = payload
            .current_auth_state
            .as_ref()
            .zip(updated_auth_state.as_ref())
            .map(|(current, updated)| AuthStateMetadataDelta::between(current, updated))
            .unwrap_or_default();
        let metadata_redemption_id = if let (Some(store), false) =
            (metadata_store, metadata_delta.is_empty())
        {
            Some(
                store
                    .issue(
                        PendingAuthStateMetadataRedemptionPayload::Delta(metadata_delta.clone()),
                        Utc::now(),
                    )
                    .map_err(|source| AuthStateCoordinatorError::MetadataRedemption { source })?
                    .id,
            )
        } else {
            None
        };

        let redirect_fragment = if let Some(auth_state) = updated_auth_state.as_ref() {
            AuthTokenDeltaRedirectFragment::from_auth_state(auth_state, metadata_redemption_id)
        } else {
            AuthTokenDeltaRedirectFragment::from_delta(&token_delta, metadata_redemption_id)
        };

        Ok(TokenRefreshCoordinationResult {
            redirect_uri,
            updated_auth_state,
            auth_state_delta: AuthStateDelta {
                tokens: token_delta,
                metadata: metadata_delta,
            },
            redirect_fragment,
        })
    }

    pub async fn handle_code_callback_with_metadata_store(
        &self,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
        pending_oauth_store: &impl PendingOauthStore,
        options: &OidcAuthStateOptions,
        metadata_store: &dyn PendingAuthStateMetadataRedemptionStore,
        redirect_url_override: Option<&str>,
    ) -> Result<CodeCallbackCoordinationResult, AuthStateCoordinatorError> {
        let result = self
            .oidc_client
            .handle_code_callback_with_redirect_override(
                search_params,
                external_base_url,
                pending_oauth_store,
                redirect_url_override,
            )
            .await
            .map_err(|source| AuthStateCoordinatorError::Oidc { source })?;
        let redirect_uri = self
            .token_set_context
            .resolve_redirect_uri(callback_redirect_uri(&result).as_deref())
            .map_err(|source| AuthStateCoordinatorError::TokenSetContext { source })?;

        self.coordinate_code_callback_result(&result, options, metadata_store, redirect_uri)
    }

    pub fn coordinate_code_callback_result(
        &self,
        result: &OidcCodeCallbackResult,
        options: &OidcAuthStateOptions,
        metadata_store: &dyn PendingAuthStateMetadataRedemptionStore,
        redirect_uri: Url,
    ) -> Result<CodeCallbackCoordinationResult, AuthStateCoordinatorError> {
        let auth_state_snapshot = self
            .token_set_context
            .auth_state_snapshot_from_code_callback(result, options)
            .map_err(|source| AuthStateCoordinatorError::TokenSetContext { source })?;
        let metadata_redemption_id = metadata_store
            .issue(
                PendingAuthStateMetadataRedemptionPayload::Snapshot(
                    auth_state_snapshot.metadata.clone(),
                ),
                Utc::now(),
            )
            .map_err(|source| AuthStateCoordinatorError::MetadataRedemption { source })?
            .id;
        let redirect_fragment = AuthTokenSnapshotRedirectFragment::from_snapshot(
            &auth_state_snapshot.tokens,
            metadata_redemption_id,
        );

        Ok(CodeCallbackCoordinationResult {
            redirect_uri,
            auth_state_snapshot,
            redirect_fragment,
        })
    }
}

fn callback_redirect_uri(result: &OidcCodeCallbackResult) -> Option<String> {
    result
        .pending_extra_data
        .as_ref()
        .and_then(|value| value.get(PENDING_REDIRECT_URI_KEY))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}
