use std::{collections::HashMap, fmt, pin::Pin, sync::Arc};

use chrono::Utc;
use securitydept_oidc_client::{
    OidcClient, OidcCodeCallbackResult, OidcCodeCallbackSearchParams,
    OidcCodeFlowAuthorizationRequest, OidcRefreshTokenResult, PendingOauthStore,
};
use serde::Deserialize;
use serde_json::{Value, json};
use typed_builder::TypedBuilder;
use url::Url;

use super::{
    AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector,
    PendingAuthStateMetadataRedemptionPayload, PendingAuthStateMetadataRedemptionStore,
    RefreshMaterialProtector, SealedRefreshMaterial, TokenSetRedirectUriConfig,
    TokenSetRedirectUriResolver, TokenSetRedirectUriRule,
    error::{BackendOidcMediatedModeRuntimeError, BackendOidcMediatedModeRuntimeResult},
    metadata_redemption::PendingAuthStateMetadataRedemptionConfig,
    transport::{
        AuthTokenDeltaRedirectFragment, AuthTokenSnapshotRedirectFragment,
        MetadataRedemptionRequest, MetadataRedemptionResponse, TokenRefreshPayload,
    },
};
use crate::models::{
    AuthStateDelta, AuthStateMetadataDelta, AuthStateMetadataSnapshot, AuthStateSnapshot,
    AuthTokenDelta, AuthTokenSnapshot, AuthenticatedPrincipal, AuthenticationSource,
    AuthenticationSourceKind, CurrentAuthStateMetadataSnapshotPartial,
    CurrentAuthenticationSourcePartial,
};

const PENDING_POST_AUTH_REDIRECT_URI_KEY: &str = "post_auth_redirect_uri";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct BackendOidcMediatedModeTokenRefreshResult {
    pub post_auth_redirect_uri: Url,
    pub auth_state_delta: AuthStateDelta,
    pub redirect_fragment: AuthTokenDeltaRedirectFragment,
}

#[derive(Debug, Clone)]
pub struct BackendOidcMediatedModeCodeCallbackResult {
    pub post_auth_redirect_uri: Url,
    pub auth_state_snapshot: AuthStateSnapshot,
    pub redirect_fragment: AuthTokenSnapshotRedirectFragment,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct BackendOidcMediatedModeRuntimeConfig<MC>
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
}

fn default_post_auth_redirect_config() -> TokenSetRedirectUriConfig {
    TokenSetRedirectUriConfig::dynamic_targets([TokenSetRedirectUriRule::All])
}

impl<MC> Default for BackendOidcMediatedModeRuntimeConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn default() -> Self {
        Self {
            master_key: None,
            sealed_refresh_token: false,
            metadata_redemption: MC::default(),
            post_auth_redirect: default_post_auth_redirect_config(),
        }
    }
}

// ---------------------------------------------------------------------------
// OIDC auth state options
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, TypedBuilder, Default)]
pub struct OidcAuthStateOptions {
    #[builder(default, setter(strip_option, into))]
    pub source_provider_id: Option<String>,
    #[builder(default)]
    pub source_attributes: HashMap<String, Value>,
    #[builder(default)]
    pub metadata_attributes: HashMap<String, Value>,
}

// ---------------------------------------------------------------------------
// Runtime struct
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct BackendOidcMediatedModeRuntime<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    refresh_material_protector: Arc<dyn RefreshMaterialProtector>,
    redirect_uri_resolver: TokenSetRedirectUriResolver,
    metadata_redemption_store: MS,
}

impl<MS> fmt::Debug for BackendOidcMediatedModeRuntime<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BackendOidcMediatedModeRuntime { refresh_material_protector: REDACTED }")
    }
}

impl<MC> BackendOidcMediatedModeRuntimeConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    pub fn validate(&self) -> BackendOidcMediatedModeRuntimeResult<()> {
        if self.sealed_refresh_token
            && self
                .master_key
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err(BackendOidcMediatedModeRuntimeError::ContextConfig {
                message: "master_key is required when sealed_refresh_token is enabled".to_string(),
            });
        }

        self.post_auth_redirect
            .validate_as_uri()
            .map_err(|source| BackendOidcMediatedModeRuntimeError::RedirectUri { source })?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Runtime impl — construction + core
// ---------------------------------------------------------------------------

impl<MS> BackendOidcMediatedModeRuntime<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    pub fn from_config(
        config: BackendOidcMediatedModeRuntimeConfig<MS::Config>,
    ) -> BackendOidcMediatedModeRuntimeResult<Self> {
        config.validate()?;

        let refresh_material_protector: Arc<dyn RefreshMaterialProtector> =
            if config.sealed_refresh_token {
                let master_key = config.master_key.as_deref().ok_or_else(|| {
                    BackendOidcMediatedModeRuntimeError::ContextConfig {
                        message: "master_key is required when sealed_refresh_token is enabled"
                            .to_string(),
                    }
                })?;

                Arc::new(
                    AeadRefreshMaterialProtector::from_master_key(master_key).map_err(
                        |source| BackendOidcMediatedModeRuntimeError::RefreshMaterial { source },
                    )?,
                )
            } else {
                Arc::new(PassthroughRefreshMaterialProtector)
            };

        let metadata_redemption_store = MS::from_config(&config.metadata_redemption)?;

        let redirect_uri_resolver =
            TokenSetRedirectUriResolver::from_config(config.post_auth_redirect);

        Ok(Self {
            refresh_material_protector,
            redirect_uri_resolver,
            metadata_redemption_store,
        })
    }

    pub fn seal_refresh_token(
        &self,
        refresh_token: &str,
    ) -> BackendOidcMediatedModeRuntimeResult<SealedRefreshMaterial> {
        self.refresh_material_protector
            .seal(refresh_token)
            .map_err(|source| BackendOidcMediatedModeRuntimeError::RefreshMaterial { source })
    }

    pub fn unseal_refresh_token(
        &self,
        material: &SealedRefreshMaterial,
    ) -> BackendOidcMediatedModeRuntimeResult<String> {
        self.refresh_material_protector
            .unseal(material)
            .map_err(|source| BackendOidcMediatedModeRuntimeError::RefreshMaterial { source })
    }

    pub fn resolve_post_auth_redirect_uri(
        &self,
        requested_post_auth_redirect_uri: Option<&str>,
    ) -> BackendOidcMediatedModeRuntimeResult<url::Url> {
        self.redirect_uri_resolver
            .resolve_redirect_uri(requested_post_auth_redirect_uri)
            .map_err(|source| BackendOidcMediatedModeRuntimeError::RedirectUri { source })
    }

    // -----------------------------------------------------------------------
    // OIDC auth state construction
    // -----------------------------------------------------------------------

    pub fn auth_state_snapshot_from_code_callback(
        &self,
        result: &OidcCodeCallbackResult,
        options: &OidcAuthStateOptions,
    ) -> Result<AuthStateSnapshot, BackendOidcMediatedModeRuntimeError> {
        let mut kind_history = Vec::new();
        push_kind_history(
            &mut kind_history,
            &AuthenticationSourceKind::OidcAuthorizationCode,
        );

        Ok(AuthStateSnapshot {
            tokens: AuthTokenSnapshot {
                access_token: result.access_token.clone(),
                id_token: Some(result.id_token.clone()),
                refresh_material: seal_optional_refresh_material(
                    self,
                    result.refresh_token.as_deref(),
                )?,
                access_token_expires_at: result.access_token_expiration,
            },
            metadata: AuthStateMetadataSnapshot {
                principal: Some(principal_from_code_callback(result)),
                source: AuthenticationSource {
                    kind: AuthenticationSourceKind::OidcAuthorizationCode,
                    provider_id: options.source_provider_id.clone(),
                    issuer: Some(result.id_token_claims.issuer().url().to_string()),
                    kind_history,
                    attributes: options.source_attributes.clone(),
                },
                attributes: options.metadata_attributes.clone(),
            },
        })
    }

    pub fn auth_state_metadata_delta_from_refresh_result(
        current_metadata: Option<&CurrentAuthStateMetadataSnapshotPartial>,
        result: &OidcRefreshTokenResult,
    ) -> AuthStateMetadataDelta {
        AuthStateMetadataDelta {
            principal: principal_from_refresh_result(result),
            source: Some(refreshed_source(
                current_metadata.and_then(|metadata| metadata.source.as_ref()),
                result,
            )),
            ..Default::default()
        }
    }

    // -----------------------------------------------------------------------
    // OIDC flow orchestration
    // -----------------------------------------------------------------------

    pub async fn authorize_code_flow<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
        redirect_url_override: Option<&str>,
    ) -> BackendOidcMediatedModeRuntimeResult<OidcCodeFlowAuthorizationRequest>
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
    ) -> BackendOidcMediatedModeRuntimeResult<BackendOidcMediatedModeTokenRefreshResult>
    where
        PS: PendingOauthStore,
    {
        self.refresh_from_payload_with_metadata_store_and_auth_state_metadata_delta_fn(
            oidc_client,
            payload,
            |metadata, result| {
                Box::pin(async move {
                    BackendOidcMediatedModeRuntime::<MS>::auth_state_metadata_delta_from_refresh_result(
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
    ) -> BackendOidcMediatedModeRuntimeResult<BackendOidcMediatedModeTokenRefreshResult>
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

        Ok(BackendOidcMediatedModeTokenRefreshResult {
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
    ) -> BackendOidcMediatedModeRuntimeResult<BackendOidcMediatedModeCodeCallbackResult>
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

        Ok(BackendOidcMediatedModeCodeCallbackResult {
            post_auth_redirect_uri,
            auth_state_snapshot,
            redirect_fragment,
        })
    }

    pub async fn redeem_metadata(
        &self,
        payload: &MetadataRedemptionRequest,
    ) -> BackendOidcMediatedModeRuntimeResult<Option<MetadataRedemptionResponse>> {
        let metadata = self
            .metadata_redemption_store
            .redeem(&payload.metadata_redemption_id, Utc::now())?;

        Ok(metadata.map(|metadata| MetadataRedemptionResponse { metadata }))
    }
}

// ---------------------------------------------------------------------------
// Private helpers — OIDC auth state construction
// ---------------------------------------------------------------------------

fn principal_from_code_callback(result: &OidcCodeCallbackResult) -> AuthenticatedPrincipal {
    AuthenticatedPrincipal {
        subject: result.id_token_claims.subject().to_string(),
        display_name: result.claims_check_result.display_name.clone(),
        picture: result.claims_check_result.picture.clone(),
        issuer: Some(result.id_token_claims.issuer().url().to_string()),
        claims: result.claims_check_result.claims.clone(),
    }
}

fn principal_from_refresh_result(
    result: &OidcRefreshTokenResult,
) -> Option<AuthenticatedPrincipal> {
    let claims_check_result = result.claims_check_result.as_ref()?;
    let id_token_claims = result.id_token_claims.as_ref()?;

    Some(AuthenticatedPrincipal {
        subject: id_token_claims.subject().to_string(),
        display_name: claims_check_result.display_name.clone(),
        picture: claims_check_result.picture.clone(),
        issuer: Some(id_token_claims.issuer().url().to_string()),
        claims: claims_check_result.claims.clone(),
    })
}

fn refreshed_source(
    current_source: Option<&CurrentAuthenticationSourcePartial>,
    result: &OidcRefreshTokenResult,
) -> AuthenticationSource {
    let mut source = AuthenticationSource {
        kind: AuthenticationSourceKind::RefreshToken,
        provider_id: current_source.and_then(|source| source.provider_id.clone()),
        issuer: current_source.and_then(|source| source.issuer.clone()),
        kind_history: current_source
            .and_then(|source| source.kind_history.as_ref())
            .cloned()
            .unwrap_or_default(),
        attributes: current_source
            .map(|source| source.attributes.clone())
            .unwrap_or_default(),
    };
    push_kind_history(
        &mut source.kind_history,
        &AuthenticationSourceKind::RefreshToken,
    );

    if let Some(id_token_claims) = result.id_token_claims.as_ref() {
        source.issuer = Some(id_token_claims.issuer().url().to_string());
    }

    source
}

fn push_kind_history(history: &mut Vec<AuthenticationSourceKind>, kind: &AuthenticationSourceKind) {
    if history.last() != Some(kind) {
        history.push(kind.clone());
    }
}

fn seal_optional_refresh_material<MS>(
    context: &BackendOidcMediatedModeRuntime<MS>,
    refresh_token: Option<&str>,
) -> Result<Option<SealedRefreshMaterial>, BackendOidcMediatedModeRuntimeError>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    refresh_token
        .map(|value| context.seal_refresh_token(value))
        .transpose()
}

fn callback_post_auth_redirect_uri(result: &OidcCodeCallbackResult) -> Option<String> {
    result
        .pending_extra_data
        .as_ref()
        .and_then(|value| value.get(PENDING_POST_AUTH_REDIRECT_URI_KEY))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

// ---------------------------------------------------------------------------
// Tests (merged from oidc.rs)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{push_kind_history, refreshed_source};
    use crate::models::{
        AuthStateMetadataDelta, AuthenticationSourceKind, CurrentAuthenticationSourcePartial,
    };

    #[test]
    fn kind_history_appends_new_kinds() {
        let mut history = Vec::new();

        push_kind_history(
            &mut history,
            &AuthenticationSourceKind::OidcAuthorizationCode,
        );
        push_kind_history(&mut history, &AuthenticationSourceKind::RefreshToken);

        assert_eq!(
            history,
            vec![
                AuthenticationSourceKind::OidcAuthorizationCode,
                AuthenticationSourceKind::RefreshToken
            ]
        );
    }

    #[test]
    fn kind_history_merges_same_top_kind() {
        let mut history = vec![AuthenticationSourceKind::RefreshToken];

        push_kind_history(&mut history, &AuthenticationSourceKind::RefreshToken);

        assert_eq!(history, vec![AuthenticationSourceKind::RefreshToken]);
    }

    #[test]
    fn metadata_delta_is_generated_without_previous_snapshot() {
        let delta: AuthStateMetadataDelta = AuthStateMetadataDelta {
            source: Some(refreshed_source(None, &mock_refresh_result())),
            ..Default::default()
        };

        assert_eq!(
            delta.source.as_ref().map(|source| &source.kind),
            Some(&AuthenticationSourceKind::RefreshToken)
        );
        assert_eq!(
            delta.source.as_ref().map(|source| &source.kind_history),
            Some(&vec![AuthenticationSourceKind::RefreshToken])
        );
    }

    #[test]
    fn refreshed_source_preserves_partial_source_fields() {
        let source = refreshed_source(
            Some(&CurrentAuthenticationSourcePartial {
                provider_id: Some("primary".to_string()),
                issuer: Some("https://issuer.example.com".to_string()),
                kind_history: Some(vec![AuthenticationSourceKind::OidcAuthorizationCode]),
                ..Default::default()
            }),
            &mock_refresh_result(),
        );

        assert_eq!(source.provider_id.as_deref(), Some("primary"));
        assert_eq!(source.issuer.as_deref(), Some("https://issuer.example.com"));
        assert_eq!(
            source.kind_history,
            vec![
                AuthenticationSourceKind::OidcAuthorizationCode,
                AuthenticationSourceKind::RefreshToken
            ]
        );
    }

    fn mock_refresh_result() -> securitydept_oidc_client::OidcRefreshTokenResult {
        securitydept_oidc_client::OidcRefreshTokenResult {
            access_token: "access-token".to_string(),
            access_token_expiration: None,
            id_token: None,
            refresh_token: None,
            id_token_claims: None,
            user_info_claims: None,
            claims_check_result: None,
        }
    }
}
