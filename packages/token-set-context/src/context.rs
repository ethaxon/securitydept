use std::{fmt, pin::Pin, sync::Arc};

use chrono::Utc;
use http::header::HeaderMap;
use securitydept_oidc_client::{
    OidcClient, OidcCodeCallbackResult, OidcCodeCallbackSearchParams,
    OidcCodeFlowAuthorizationRequest, OidcRefreshTokenResult, PendingOauthStore,
};
use serde::Deserialize;
use serde_json::json;
use typed_builder::TypedBuilder;
use url::Url;

use crate::{
    AeadRefreshMaterialProtector, AuthStateDelta, AuthStateMetadataDelta, AuthStateSnapshot,
    AuthTokenDelta, AuthTokenDeltaRedirectFragment, AuthTokenSnapshotRedirectFragment,
    CurrentAuthStateMetadataSnapshotPartial, MetadataRedemptionRequest, MetadataRedemptionResponse,
    OidcAuthStateOptions, PassthroughRefreshMaterialProtector,
    PendingAuthStateMetadataRedemptionPayload, PendingAuthStateMetadataRedemptionStore,
    PropagatedBearer, PropagationNodeTargetResolver, PropagationRequestTarget,
    RefreshMaterialProtector, SealedRefreshMaterial, TokenPropagator, TokenPropagatorConfig,
    TokenRefreshPayload, TokenSetRedirectUriConfig, TokenSetRedirectUriResolver,
    TokenSetRedirectUriRule,
    error::{MediatedContextError, MediatedContextResult},
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
};

const PENDING_POST_AUTH_REDIRECT_URI_KEY: &str = "post_auth_redirect_uri";

#[derive(Debug, Clone)]
pub struct MediatedContextTokenRefreshResult {
    pub post_auth_redirect_uri: Url,
    pub auth_state_delta: AuthStateDelta,
    pub redirect_fragment: AuthTokenDeltaRedirectFragment,
}

#[derive(Debug, Clone)]
pub struct MediatedContextCodeCallbackResult {
    pub post_auth_redirect_uri: Url,
    pub auth_state_snapshot: AuthStateSnapshot,
    pub redirect_fragment: AuthTokenSnapshotRedirectFragment,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct MediatedContextConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    #[builder(default)]
    #[serde(default)]
    pub master_key: Option<String>,
    #[builder(default)]
    #[serde(default)]
    pub sealed_refresh_token: bool,
    #[builder(default)]
    #[serde(
        default,
        bound(deserialize = "MC: PendingAuthStateMetadataRedemptionConfig")
    )]
    pub metadata_redemption: MC,
    #[builder(default = default_post_auth_redirect_config())]
    #[serde(default = "default_post_auth_redirect_config")]
    pub post_auth_redirect: TokenSetRedirectUriConfig,
    #[builder(default)]
    #[serde(default)]
    pub token_propagation: TokenPropagatorConfig,
}

fn default_post_auth_redirect_config() -> TokenSetRedirectUriConfig {
    TokenSetRedirectUriConfig::dynamic_targets([TokenSetRedirectUriRule::All])
}

impl<MC> Default for MediatedContextConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn default() -> Self {
        Self {
            master_key: None,
            sealed_refresh_token: false,
            metadata_redemption: MC::default(),
            post_auth_redirect: default_post_auth_redirect_config(),
            token_propagation: TokenPropagatorConfig::default(),
        }
    }
}

#[derive(Clone)]
pub struct MediatedContext<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    refresh_material_protector: Arc<dyn RefreshMaterialProtector>,
    redirect_uri_resolver: TokenSetRedirectUriResolver,
    token_propagator: TokenPropagator,
    metadata_redemption_store: MS,
}

impl<MS> fmt::Debug for MediatedContext<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("MediatedContext { refresh_material_protector: REDACTED }")
    }
}

impl<MC> MediatedContextConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub fn validate(&self) -> MediatedContextResult<()> {
        if self.sealed_refresh_token
            && self
                .master_key
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err(MediatedContextError::ContextConfig {
                message: "master_key is required when sealed_refresh_token is enabled".to_string(),
            });
        }

        self.post_auth_redirect
            .validate_as_uri()
            .map_err(|source| MediatedContextError::RedirectUri { source })?;
        self.token_propagation
            .validate()
            .map_err(|source| MediatedContextError::TokenPropagatorError { source })?;

        Ok(())
    }
}

impl<MS> MediatedContext<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    pub fn from_config(config: MediatedContextConfig<MS::Config>) -> MediatedContextResult<Self> {
        Self::from_config_with_node_target_resolver(config, None)
    }

    pub fn from_config_with_node_target_resolver(
        config: MediatedContextConfig<MS::Config>,
        node_target_resolver: Option<Arc<dyn PropagationNodeTargetResolver>>,
    ) -> MediatedContextResult<Self> {
        config.validate()?;

        let refresh_material_protector: Arc<dyn RefreshMaterialProtector> =
            if config.sealed_refresh_token {
                let master_key = config.master_key.as_deref().ok_or_else(|| {
                    MediatedContextError::ContextConfig {
                        message: "master_key is required when sealed_refresh_token is enabled"
                            .to_string(),
                    }
                })?;

                Arc::new(
                    AeadRefreshMaterialProtector::from_master_key(master_key)
                        .map_err(|source| MediatedContextError::RefreshMaterial { source })?,
                )
            } else {
                Arc::new(PassthroughRefreshMaterialProtector)
            };

        let token_propagator = TokenPropagator::from_config_with_node_target_resolver(
            &config.token_propagation,
            node_target_resolver,
        )?;

        let metadata_redemption_store = MS::from_config(&config.metadata_redemption)?;

        let redirect_uri_resolver =
            TokenSetRedirectUriResolver::from_config(config.post_auth_redirect);

        Ok(Self {
            refresh_material_protector,
            redirect_uri_resolver,
            metadata_redemption_store,
            token_propagator,
        })
    }

    pub fn seal_refresh_token(
        &self,
        refresh_token: &str,
    ) -> MediatedContextResult<SealedRefreshMaterial> {
        self.refresh_material_protector
            .seal(refresh_token)
            .map_err(|source| MediatedContextError::RefreshMaterial { source })
    }

    pub fn unseal_refresh_token(
        &self,
        material: &SealedRefreshMaterial,
    ) -> MediatedContextResult<String> {
        self.refresh_material_protector
            .unseal(material)
            .map_err(|source| MediatedContextError::RefreshMaterial { source })
    }

    pub fn resolve_post_auth_redirect_uri(
        &self,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> MediatedContextResult<url::Url> {
        self.redirect_uri_resolver
            .resolve_redirect_uri(requested_post_auth_redirect_uri)
            .map_err(|source| MediatedContextError::RedirectUri { source })
    }

    pub fn token_propagator(&self) -> &TokenPropagator {
        &self.token_propagator
    }

    pub fn set_node_target_resolver(
        &self,
        node_target_resolver: Option<Arc<dyn PropagationNodeTargetResolver>>,
    ) {
        self.token_propagator
            .set_node_target_resolver(node_target_resolver);
    }

    pub fn validate_propagation_target(
        &self,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
    ) -> MediatedContextResult<()> {
        self.token_propagator
            .validate_target(bearer, target)
            .map_err(|source| MediatedContextError::TokenPropagatorError { source })
    }

    pub fn propagation_authorization_header_value(
        &self,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
    ) -> MediatedContextResult<http::header::HeaderValue> {
        self.token_propagator
            .authorization_header_value(bearer, target)
            .map_err(|source| MediatedContextError::TokenPropagatorError { source })
    }

    pub fn apply_propagation_authorization_header(
        &self,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
        headers: &mut HeaderMap,
    ) -> MediatedContextResult<()> {
        self.token_propagator
            .apply_authorization_header(bearer, target, headers)
            .map_err(|source| MediatedContextError::TokenPropagatorError { source })
    }

    pub async fn authorize_code_flow<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
        redirect_url_override: Option<&str>,
    ) -> MediatedContextResult<OidcCodeFlowAuthorizationRequest>
    where
        PS: PendingOauthStore,
    {
        let post_auth_redirect_uri =
            self.resolve_post_auth_redirect_uri(requested_post_auth_redirect_uri)?;

        let request = oidc_client
            .handle_code_authorize_with_redirect_override_and_extra_data(
                external_base_url,
                redirect_url_override,
                Some(json!({
                    PENDING_POST_AUTH_REDIRECT_URI_KEY: post_auth_redirect_uri.as_str(),
                })),
            )
            .await?;

        Ok(request)
    }

    pub async fn refresh_from_payload_with_metadata_store<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        payload: &TokenRefreshPayload,
    ) -> MediatedContextResult<MediatedContextTokenRefreshResult>
    where
        PS: PendingOauthStore,
    {
        self.refresh_from_payload_with_metadata_store_and_auth_state_metadata_delta_fn(
            oidc_client,
            payload,
            |metadata, result| {
                Box::pin(async move {
                    MediatedContext::<MS>::auth_state_metadata_delta_from_refresh_result(
                        metadata, result,
                    )
                })
            },
        )
        .await
    }

    pub async fn refresh_from_payload_with_metadata_store_and_auth_state_metadata_delta_fn<PS, F>(
        &self,
        oidc_client: &OidcClient<PS>,
        payload: &TokenRefreshPayload,
        auth_state_metadata_delta_fn: F,
    ) -> MediatedContextResult<MediatedContextTokenRefreshResult>
    where
        PS: PendingOauthStore,
        F: for<'c> FnOnce(
            Option<&'c CurrentAuthStateMetadataSnapshotPartial>,
            &'c OidcRefreshTokenResult,
        )
            -> Pin<Box<dyn Future<Output = AuthStateMetadataDelta> + Send + 'c>>,
    {
        let post_auth_redirect_uri =
            self.resolve_post_auth_redirect_uri(payload.post_auth_redirect_uri.as_deref())?;
        let refresh_token = self.unseal_refresh_token(&payload.refresh_material)?;
        let refresh_result = oidc_client
            .handle_token_refresh(refresh_token, payload.id_token.clone())
            .await?;
        let refresh_material_delta = refresh_result
            .refresh_token
            .as_deref()
            .map(|value| self.seal_refresh_token(value))
            .transpose()?;
        let token_delta = AuthTokenDelta {
            access_token: refresh_result.access_token.clone(),
            id_token: refresh_result.id_token.clone(),
            refresh_material: refresh_material_delta,
            access_token_expires_at: refresh_result.access_token_expiration,
        };
        let metadata_delta = auth_state_metadata_delta_fn(
            payload.current_metadata_snapshot.as_ref(),
            &refresh_result,
        )
        .await;
        let metadata_redemption_id = if metadata_delta.is_empty() {
            Some(
                self.metadata_redemption_store
                    .issue(
                        PendingAuthStateMetadataRedemptionPayload::Delta(metadata_delta.clone()),
                        Utc::now(),
                    )?
                    .id,
            )
        } else {
            None
        };

        let redirect_fragment =
            AuthTokenDeltaRedirectFragment::from_delta(&token_delta, metadata_redemption_id);

        Ok(MediatedContextTokenRefreshResult {
            post_auth_redirect_uri,
            auth_state_delta: AuthStateDelta {
                tokens: token_delta,
                metadata: metadata_delta,
            },
            redirect_fragment,
        })
    }

    pub async fn handle_code_callback_with_metadata_store<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
        auth_state_options: &OidcAuthStateOptions,
        redirect_url_override: Option<&str>,
    ) -> MediatedContextResult<MediatedContextCodeCallbackResult>
    where
        PS: PendingOauthStore,
    {
        let result = oidc_client
            .handle_code_callback_with_redirect_override(
                search_params,
                external_base_url,
                redirect_url_override,
            )
            .await?;
        let post_auth_redirect_uri = self
            .resolve_post_auth_redirect_uri(callback_post_auth_redirect_uri(&result).as_deref())?;

        let auth_state_snapshot =
            self.auth_state_snapshot_from_code_callback(&result, auth_state_options)?;
        let metadata_redemption_id = self
            .metadata_redemption_store
            .issue(
                PendingAuthStateMetadataRedemptionPayload::Snapshot(
                    auth_state_snapshot.metadata.clone(),
                ),
                Utc::now(),
            )?
            .id;
        let redirect_fragment = AuthTokenSnapshotRedirectFragment::from_snapshot(
            &auth_state_snapshot.tokens,
            metadata_redemption_id,
        );

        Ok(MediatedContextCodeCallbackResult {
            post_auth_redirect_uri,
            auth_state_snapshot,
            redirect_fragment,
        })
    }

    pub async fn redeem_metadata(
        &self,
        payload: &MetadataRedemptionRequest,
    ) -> MediatedContextResult<Option<MetadataRedemptionResponse>> {
        let metadata = self
            .metadata_redemption_store
            .redeem(&payload.metadata_redemption_id, Utc::now())?;

        Ok(metadata.map(|metadata| MetadataRedemptionResponse { metadata }))
    }
}

fn callback_post_auth_redirect_uri(result: &OidcCodeCallbackResult) -> Option<String> {
    result
        .pending_extra_data
        .as_ref()
        .and_then(|value| value.get(PENDING_POST_AUTH_REDIRECT_URI_KEY))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}
