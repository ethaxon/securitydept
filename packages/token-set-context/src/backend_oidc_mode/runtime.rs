use std::{collections::HashMap, fmt, sync::Arc};

use chrono::Utc;
use http::StatusCode;
use securitydept_oidc_client::{
    OidcClient, OidcCodeCallbackResult, OidcCodeCallbackSearchParams,
    OidcCodeFlowAuthorizationRequest, OidcRefreshTokenResult, PendingOauthStore,
    auth_state::{
        OidcExtractedPrincipal, extract_issuer_from_refresh_result,
        extract_principal_from_code_callback, extract_principal_from_refresh_result,
    },
};
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
    http::ToHttpStatus,
};
use serde::Deserialize;
use serde_json::{Value, json};
use snafu::Snafu;
use url::Url;

use super::{
    capabilities::{
        MetadataDelivery, MetadataDeliveryKind, PostAuthRedirectPolicy, RefreshMaterialProtection,
    },
    metadata_redemption::{
        MetadataRedemptionId, PendingAuthStateMetadataRedemptionConfig,
        PendingAuthStateMetadataRedemptionPayload, PendingAuthStateMetadataRedemptionStore,
    },
    redirect::BackendOidcModeRedirectUriResolver,
    refresh_material::{
        AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector,
        RefreshMaterialProtector, SealedRefreshMaterial,
    },
    transport::{
        BackendOidcModeCallbackReturns, BackendOidcModeRefreshPayload,
        BackendOidcModeRefreshReturns,
    },
};
use crate::{
    backend_oidc_mode::config::ResolvedBackendOidcModeConfig,
    models::{
        AuthStateDelta, AuthStateMetadataDelta, AuthStateMetadataSnapshot, AuthStateSnapshot,
        AuthTokenDelta, AuthTokenSnapshot, AuthenticatedPrincipal, AuthenticationSource,
        AuthenticationSourceKind, CurrentAuthStateMetadataSnapshotPartial,
    },
};

const PENDING_POST_AUTH_REDIRECT_URI_KEY: &str = "post_auth_redirect_uri";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/// Result of a backend-oidc code callback flow.
#[derive(Debug, Clone)]
pub struct BackendOidcModeCodeCallbackResult {
    /// Present only when `post_auth_redirect_policy = resolved`.
    pub post_auth_redirect_uri: Option<Url>,
    pub auth_state_snapshot: AuthStateSnapshot,
    pub response_body: BackendOidcModeCallbackReturns,
}

/// Result of a backend-oidc token refresh flow.
#[derive(Debug, Clone)]
pub struct BackendOidcModeTokenRefreshResult {
    /// Present only when `post_auth_redirect_policy = resolved`.
    pub post_auth_redirect_uri: Option<Url>,
    pub auth_state_delta: AuthStateDelta,
    pub response_body: BackendOidcModeRefreshReturns,
}

// ---------------------------------------------------------------------------
// Auth state options
// ---------------------------------------------------------------------------

/// Options for OIDC auth-state construction.
#[derive(Debug, Clone, Default)]
pub struct BackendOidcModeAuthStateOptions {
    pub source_provider_id: Option<String>,
    pub source_attributes: HashMap<String, Value>,
    pub metadata_attributes: HashMap<String, Value>,
}

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------

/// Configuration for the unified backend-oidc runtime.
///
/// Each capability axis is a structured enum that carries its associated
/// configuration. This eliminates scattered sibling fields and lets the type
/// system enforce invariants (e.g. `Sealed` always has a `master_key`).
///
/// ```text
/// refresh_material_protection: Sealed { master_key }  | Passthrough
/// metadata_delivery:           Redemption { config }  | None
/// post_auth_redirect:          Resolved { config }    | CallerValidated
/// ```
///
/// Note: `token_propagation` has been moved to
/// [`AccessTokenSubstrateConfig`](crate::access_token_substrate::AccessTokenSubstrateConfig)
/// as a substrate-level capability axis.
#[derive(Debug, Clone, Deserialize)]
pub struct BackendOidcModeRuntimeConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    #[serde(default, bound(deserialize = ""))]
    pub refresh_material_protection: RefreshMaterialProtection,

    #[serde(
        default,
        bound(deserialize = "MC: PendingAuthStateMetadataRedemptionConfig")
    )]
    pub metadata_delivery: MetadataDelivery<MC>,

    #[serde(default)]
    pub post_auth_redirect: PostAuthRedirectPolicy,
}

impl<MC> Default for BackendOidcModeRuntimeConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    fn default() -> Self {
        Self {
            refresh_material_protection: RefreshMaterialProtection::default(),
            metadata_delivery: MetadataDelivery::default(),
            post_auth_redirect: PostAuthRedirectPolicy::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/// Unified backend-oidc runtime.
///
/// Parameterized by a metadata-redemption store (which may be a no-op for
/// the pure preset). Provides the single implementation of authorize,
/// callback, refresh, and metadata redemption.
#[derive(Clone)]
pub struct BackendOidcModeRuntime<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    refresh_material_protector: Arc<dyn RefreshMaterialProtector>,
    redirect_uri_resolver: Option<BackendOidcModeRedirectUriResolver>,
    metadata_redemption_store: Option<MS>,
    metadata_delivery_kind: MetadataDeliveryKind,
}

impl<MS> fmt::Debug for BackendOidcModeRuntime<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BackendOidcModeRuntime { ... }")
    }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/// Error type for the unified backend-oidc runtime.
#[derive(Debug, Snafu)]
pub enum BackendOidcModeRuntimeError {
    #[snafu(display("oidc: {source}"), context(false))]
    Oidc {
        source: securitydept_oidc_client::OidcError,
    },

    #[snafu(display("refresh_material: {source}"), context(false))]
    RefreshMaterial {
        source: super::refresh_material::RefreshMaterialError,
    },

    #[snafu(display("redirect_uri: {source}"), context(false))]
    RedirectUri {
        source: super::redirect::BackendOidcModeRedirectUriError,
    },

    #[snafu(display("metadata_store: {source}"), context(false))]
    MetadataStore {
        source: super::metadata_redemption::PendingAuthStateMetadataRedemptionStoreError,
    },

    #[snafu(display("config: {message}"))]
    Config { message: String },
}

pub type BackendOidcModeRuntimeResult<T> = Result<T, BackendOidcModeRuntimeError>;

impl ToErrorPresentation for BackendOidcModeRuntimeError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::Oidc { source } => source.to_error_presentation(),
            Self::Config { .. } => ErrorPresentation::new(
                "backend_oidc_mode_config_invalid",
                "Backend-oidc mode runtime is misconfigured.",
                UserRecovery::ContactSupport,
            ),
            Self::RefreshMaterial { .. } => ErrorPresentation::new(
                "backend_oidc_mode_refresh_material_invalid",
                "The sign-in state is no longer valid. Sign in again.",
                UserRecovery::Reauthenticate,
            ),
            Self::RedirectUri { .. } => ErrorPresentation::new(
                "backend_oidc_mode_redirect_uri_invalid",
                "The redirect URL is invalid.",
                UserRecovery::RestartFlow,
            ),
            Self::MetadataStore { .. } => ErrorPresentation::new(
                "backend_oidc_mode_metadata_unavailable",
                "Authentication metadata is temporarily unavailable.",
                UserRecovery::Retry,
            ),
        }
    }
}

impl ToHttpStatus for BackendOidcModeRuntimeError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            Self::Oidc { source } => source.to_http_status(),
            Self::Config { .. }
            | Self::RefreshMaterial { .. }
            | Self::RedirectUri { .. }
            | Self::MetadataStore { .. } => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

impl<MC> BackendOidcModeRuntimeConfig<MC>
where
    MC: PendingAuthStateMetadataRedemptionConfig,
{
    /// Validate the configuration without constructing the runtime.
    ///
    /// Most invariants are enforced by the structured enum types.
    /// This method validates things the type system cannot
    /// (e.g. redirect URI format).
    pub fn validate(&self) -> BackendOidcModeRuntimeResult<()> {
        if let PostAuthRedirectPolicy::Resolved { ref config } = self.post_auth_redirect {
            config.validate_as_uri_reference()?;
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Runtime impl — construction
// ---------------------------------------------------------------------------

impl<MS> BackendOidcModeRuntime<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    /// Build the unified runtime from its config.
    pub fn from_config(
        config: BackendOidcModeRuntimeConfig<MS::Config>,
    ) -> BackendOidcModeRuntimeResult<Self> {
        // Build refresh material protector — the `Sealed` variant carries
        // master_key by type, so no Option check needed.
        let refresh_material_protector: Arc<dyn RefreshMaterialProtector> = match &config
            .refresh_material_protection
        {
            RefreshMaterialProtection::Sealed { master_key } => {
                Arc::new(AeadRefreshMaterialProtector::from_master_key(master_key)?)
            }
            RefreshMaterialProtection::Passthrough => Arc::new(PassthroughRefreshMaterialProtector),
        };

        // Build metadata redemption store — the `Redemption` variant carries
        // the store config by type.
        let metadata_delivery_kind = config.metadata_delivery.kind();
        let metadata_redemption_store = match &config.metadata_delivery {
            MetadataDelivery::Redemption { config } => Some(MS::from_config(config)?),
            MetadataDelivery::None => None,
        };

        // Build redirect URI resolver — the `Resolved` variant carries the
        // redirect config by type.
        let redirect_uri_resolver = match config.post_auth_redirect {
            PostAuthRedirectPolicy::Resolved { ref config } => {
                config.validate_as_uri_reference()?;
                Some(BackendOidcModeRedirectUriResolver::from_config(
                    config.clone(),
                ))
            }
            PostAuthRedirectPolicy::CallerValidated => None,
        };

        Ok(Self {
            refresh_material_protector,
            redirect_uri_resolver,
            metadata_redemption_store,
            metadata_delivery_kind,
        })
    }

    /// **Recommended entry point.** Build both the runtime and the optional
    /// OIDC client from a resolved backend-oidc config.
    ///
    /// Mirrors [`AccessTokenSubstrateRuntime::from_resolved_config`]:
    ///
    /// ```text
    /// BackendOidcModeRuntime::from_resolved_config(resolved_oidc.as_ref()).await?
    ///   ──▸ (BackendOidcModeRuntime<MS>, Option<Arc<OidcClient<PS>>>)
    ///
    /// AccessTokenSubstrateRuntime::from_resolved_config(&resolved_substrate).await?
    ///   ──▸ (AccessTokenSubstrateRuntime, Option<Arc<OAuthResourceServerVerifier>>)
    /// ```
    ///
    /// Pass `None` when OIDC is disabled — the runtime is built from a default
    /// config and `oidc_client` will be `None`.
    ///
    /// # Type parameters
    /// - `PS` — pending OAuth store (Store type, e.g. `MokaPendingOauthStore`)
    /// - `MS` — pending auth-state metadata redemption store (inferred from
    ///   `Self`)
    pub async fn from_resolved_config<PS>(
        resolved: Option<&ResolvedBackendOidcModeConfig<PS::Config, MS::Config>>,
    ) -> BackendOidcModeRuntimeResult<(Self, Option<Arc<OidcClient<PS>>>)>
    where
        PS: PendingOauthStore,
        PS::Config: Clone,
        MS::Config: Clone,
    {
        let (runtime_config, oidc_client) = match resolved {
            Some(r) => {
                let client = OidcClient::<PS>::from_config(r.oidc_client.clone()).await?;
                (r.runtime.clone(), Some(Arc::new(client)))
            }
            None => (BackendOidcModeRuntimeConfig::default(), None),
        };

        let runtime = Self::from_config(runtime_config)?;
        Ok((runtime, oidc_client))
    }

    // -----------------------------------------------------------------------
    // Low-level helpers
    // -----------------------------------------------------------------------

    pub fn seal_refresh_token(
        &self,
        refresh_token: &str,
    ) -> BackendOidcModeRuntimeResult<SealedRefreshMaterial> {
        self.refresh_material_protector
            .seal(refresh_token)
            .map_err(Into::into)
    }

    pub fn unseal_refresh_token(
        &self,
        material: &SealedRefreshMaterial,
    ) -> BackendOidcModeRuntimeResult<String> {
        self.refresh_material_protector
            .unseal(material)
            .map_err(Into::into)
    }

    fn resolve_post_auth_redirect_uri(
        &self,
        requested: Option<&str>,
        external_base_url: &Url,
    ) -> BackendOidcModeRuntimeResult<Option<Url>> {
        match &self.redirect_uri_resolver {
            Some(resolver) => resolver
                .resolve_redirect_uri(requested, external_base_url)
                .map(Some)
                .map_err(Into::into),
            None => Ok(None), // caller_validated — no resolution here
        }
    }

    // -----------------------------------------------------------------------
    // Auth-state construction (unified from pure + mediated)
    // -----------------------------------------------------------------------

    pub fn auth_state_snapshot_from_code_callback(
        &self,
        result: &OidcCodeCallbackResult,
        options: &BackendOidcModeAuthStateOptions,
    ) -> BackendOidcModeRuntimeResult<AuthStateSnapshot> {
        let mut kind_history = Vec::new();
        push_kind_history(
            &mut kind_history,
            &AuthenticationSourceKind::OidcAuthorizationCode,
        );

        let extracted = extract_principal_from_code_callback(result);

        Ok(AuthStateSnapshot {
            tokens: AuthTokenSnapshot {
                access_token: result.access_token.clone(),
                id_token: result.id_token.clone(),
                refresh_material: seal_optional_refresh_material(
                    self,
                    result.refresh_token.as_deref(),
                )?,
                access_token_expires_at: result.access_token_expiration,
            },
            metadata: AuthStateMetadataSnapshot {
                principal: Some(into_authenticated_principal(extracted)),
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
        let principal =
            extract_principal_from_refresh_result(result).map(into_authenticated_principal);

        AuthStateMetadataDelta {
            principal,
            source: Some(refreshed_source(
                current_metadata.and_then(|m| m.source.as_ref()),
                result,
            )),
            ..Default::default()
        }
    }

    // -----------------------------------------------------------------------
    // OIDC flow orchestration
    // -----------------------------------------------------------------------

    /// Build an authorization URL for the OIDC code flow.
    ///
    /// When `post_auth_redirect_policy = resolved`, the
    /// `post_auth_redirect_uri` is resolved against the allowlist and
    /// encoded into the OIDC state. When `caller_validated`, no redirect
    /// URI is embedded.
    pub async fn authorize_code_flow<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        external_base_url: &Url,
        requested_post_auth_redirect_uri: Option<&str>,
        redirect_url_override: Option<&str>,
    ) -> BackendOidcModeRuntimeResult<OidcCodeFlowAuthorizationRequest>
    where
        PS: PendingOauthStore,
    {
        // Validate the requested redirect URI against the allowlist (if the
        // Resolved policy is active). We discard the resolved Url and store
        // the *original* requested string — the callback will re-resolve it.
        // Storing the original avoids a double-resolve mismatch where the
        // allowlist contains relative paths but the stored value is absolute.
        if requested_post_auth_redirect_uri.is_some() {
            let _ = self.resolve_post_auth_redirect_uri(
                requested_post_auth_redirect_uri,
                external_base_url,
            )?;
        }

        let extra_data = requested_post_auth_redirect_uri.map(|uri| {
            json!({
                PENDING_POST_AUTH_REDIRECT_URI_KEY: uri,
            })
        });

        let request = oidc_client
            .handle_code_authorize_with_redirect_override_and_extra_data(
                external_base_url,
                redirect_url_override,
                extra_data,
            )
            .await?;

        Ok(request)
    }

    /// Handle the OIDC code callback.
    pub async fn handle_code_callback<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
        auth_state_options: &BackendOidcModeAuthStateOptions,
        redirect_url_override: Option<&str>,
    ) -> BackendOidcModeRuntimeResult<BackendOidcModeCodeCallbackResult>
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

        // Resolve post_auth_redirect_uri.
        let post_auth_redirect_uri = if self.redirect_uri_resolver.is_some() {
            self.resolve_post_auth_redirect_uri(
                callback_post_auth_redirect_uri(&result).as_deref(),
                external_base_url,
            )?
        } else {
            None
        };

        let auth_state_snapshot =
            self.auth_state_snapshot_from_code_callback(&result, auth_state_options)?;

        // Issue metadata redemption if active.
        let metadata_redemption_id = self.issue_metadata_snapshot(&auth_state_snapshot)?;

        let response_body = BackendOidcModeCallbackReturns::from_snapshot(
            &auth_state_snapshot.tokens,
            metadata_redemption_id,
        );

        Ok(BackendOidcModeCodeCallbackResult {
            post_auth_redirect_uri,
            auth_state_snapshot,
            response_body,
        })
    }

    /// Handle a token refresh.
    pub async fn handle_token_refresh<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        payload: &BackendOidcModeRefreshPayload,
        external_base_url: &Url,
    ) -> BackendOidcModeRuntimeResult<BackendOidcModeTokenRefreshResult>
    where
        PS: PendingOauthStore,
    {
        // Resolve post_auth_redirect_uri.
        let post_auth_redirect_uri = if self.redirect_uri_resolver.is_some() {
            self.resolve_post_auth_redirect_uri(
                payload.post_auth_redirect_uri.as_deref(),
                external_base_url,
            )?
        } else {
            None
        };

        // Unseal or passthrough refresh token.
        let refresh_token = self.unseal_refresh_token(&payload.refresh_material)?;

        let refresh_result = oidc_client
            .handle_token_refresh(refresh_token, payload.id_token.clone())
            .await?;

        // Re-seal or passthrough the new refresh token.
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

        let metadata_delta = Self::auth_state_metadata_delta_from_refresh_result(
            payload.current_metadata_snapshot.as_ref(),
            &refresh_result,
        );

        // Issue metadata redemption if active AND metadata is non-empty.
        let metadata_redemption_id = self.issue_metadata_delta(&metadata_delta)?;

        let response_body =
            BackendOidcModeRefreshReturns::from_delta(&token_delta, metadata_redemption_id);

        Ok(BackendOidcModeTokenRefreshResult {
            post_auth_redirect_uri,
            auth_state_delta: AuthStateDelta {
                tokens: token_delta,
                metadata: metadata_delta,
            },
            response_body,
        })
    }

    /// Handle the OIDC code callback for a JSON body response, embedding
    /// metadata inline.
    ///
    /// Compared to [`handle_code_callback`](Self::handle_code_callback) this
    /// method:
    ///
    /// - Skips `post_auth_redirect_uri` resolution (irrelevant for body flows)
    /// - Skips `issue_metadata_snapshot` and the associated store write
    /// - Embeds `AuthStateMetadataSnapshot` directly in the response body
    ///
    /// This removes one store write and one client redemption round-trip,
    /// making it the preferred implementation for `callback_body_return`.
    pub async fn handle_code_callback_inline<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        search_params: OidcCodeCallbackSearchParams,
        external_base_url: &Url,
        auth_state_options: &BackendOidcModeAuthStateOptions,
        redirect_url_override: Option<&str>,
    ) -> BackendOidcModeRuntimeResult<BackendOidcModeCodeCallbackResult>
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

        let auth_state_snapshot =
            self.auth_state_snapshot_from_code_callback(&result, auth_state_options)?;

        // Embed metadata inline — no store write, no redemption ID.
        let response_body = BackendOidcModeCallbackReturns::from_snapshot_with_inline_metadata(
            &auth_state_snapshot.tokens,
            auth_state_snapshot.metadata.clone(),
        );

        Ok(BackendOidcModeCodeCallbackResult {
            post_auth_redirect_uri: None,
            auth_state_snapshot,
            response_body,
        })
    }

    /// Handle a token refresh for a JSON body response, embedding metadata
    /// inline.
    ///
    /// Compared to [`handle_token_refresh`](Self::handle_token_refresh) this
    /// method:
    ///
    /// - Skips `post_auth_redirect_uri` resolution (irrelevant for body flows)
    /// - Skips `issue_metadata_delta` and the associated store write
    /// - Embeds `AuthStateMetadataDelta` directly in the response body
    ///
    /// This removes one store write and one client redemption round-trip,
    /// making it the preferred implementation for `refresh_body_return`.
    pub async fn handle_token_refresh_inline<PS>(
        &self,
        oidc_client: &OidcClient<PS>,
        payload: &BackendOidcModeRefreshPayload,
    ) -> BackendOidcModeRuntimeResult<BackendOidcModeTokenRefreshResult>
    where
        PS: PendingOauthStore,
    {
        // Unseal or passthrough refresh token.
        let refresh_token = self.unseal_refresh_token(&payload.refresh_material)?;

        let refresh_result = oidc_client
            .handle_token_refresh(refresh_token, payload.id_token.clone())
            .await?;

        // Re-seal or passthrough the new refresh token.
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

        let metadata_delta = Self::auth_state_metadata_delta_from_refresh_result(
            payload.current_metadata_snapshot.as_ref(),
            &refresh_result,
        );

        // Embed metadata inline — no store write, no redemption ID.
        let response_body = BackendOidcModeRefreshReturns::from_delta_with_inline_metadata(
            &token_delta,
            metadata_delta.clone(),
        );

        Ok(BackendOidcModeTokenRefreshResult {
            post_auth_redirect_uri: None,
            auth_state_delta: AuthStateDelta {
                tokens: token_delta,
                metadata: metadata_delta,
            },
            response_body,
        })
    }

    /// Redeem metadata by one-time redemption id.
    pub async fn redeem_metadata(
        &self,
        payload: &super::transport::BackendOidcModeMetadataRedemptionRequest,
    ) -> BackendOidcModeRuntimeResult<
        Option<super::transport::BackendOidcModeMetadataRedemptionResponse>,
    > {
        let store = self.metadata_redemption_store.as_ref().ok_or_else(|| {
            BackendOidcModeRuntimeError::Config {
                message: "metadata redemption is not enabled in this configuration".to_string(),
            }
        })?;

        let metadata = store.redeem(&payload.metadata_redemption_id, Utc::now())?;

        Ok(metadata
            .map(|m| super::transport::BackendOidcModeMetadataRedemptionResponse { metadata: m }))
    }

    // -----------------------------------------------------------------------
    // Internal — metadata issuance helpers
    // -----------------------------------------------------------------------

    fn issue_metadata_snapshot(
        &self,
        snapshot: &AuthStateSnapshot,
    ) -> BackendOidcModeRuntimeResult<Option<MetadataRedemptionId>> {
        match (
            &self.metadata_delivery_kind,
            &self.metadata_redemption_store,
        ) {
            (MetadataDeliveryKind::Redemption, Some(store)) => {
                let ticket = store.issue(
                    PendingAuthStateMetadataRedemptionPayload::Snapshot(snapshot.metadata.clone()),
                    Utc::now(),
                )?;
                Ok(Some(ticket.id))
            }
            _ => Ok(None),
        }
    }

    fn issue_metadata_delta(
        &self,
        delta: &AuthStateMetadataDelta,
    ) -> BackendOidcModeRuntimeResult<Option<MetadataRedemptionId>> {
        match (
            &self.metadata_delivery_kind,
            &self.metadata_redemption_store,
        ) {
            (MetadataDeliveryKind::Redemption, Some(store)) if delta.is_empty() => {
                let ticket = store.issue(
                    PendingAuthStateMetadataRedemptionPayload::Delta(delta.clone()),
                    Utc::now(),
                )?;
                Ok(Some(ticket.id))
            }
            _ => Ok(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers — shared auth-state construction
// ---------------------------------------------------------------------------

fn refreshed_source(
    current_source: Option<&crate::models::CurrentAuthenticationSourcePartial>,
    result: &OidcRefreshTokenResult,
) -> AuthenticationSource {
    let mut source = AuthenticationSource {
        kind: AuthenticationSourceKind::RefreshToken,
        provider_id: current_source.and_then(|s| s.provider_id.clone()),
        issuer: current_source.and_then(|s| s.issuer.clone()),
        kind_history: current_source
            .and_then(|s| s.kind_history.as_ref())
            .cloned()
            .unwrap_or_default(),
        attributes: current_source
            .map(|s| s.attributes.clone())
            .unwrap_or_default(),
    };
    push_kind_history(
        &mut source.kind_history,
        &AuthenticationSourceKind::RefreshToken,
    );

    if let Some(issuer) = extract_issuer_from_refresh_result(result) {
        source.issuer = Some(issuer);
    }

    source
}

fn into_authenticated_principal(extracted: OidcExtractedPrincipal) -> AuthenticatedPrincipal {
    AuthenticatedPrincipal {
        subject: extracted.subject,
        display_name: extracted.display_name,
        picture: extracted.picture,
        issuer: extracted.issuer,
        claims: extracted.claims,
    }
}

fn push_kind_history(history: &mut Vec<AuthenticationSourceKind>, kind: &AuthenticationSourceKind) {
    if history.last() != Some(kind) {
        history.push(kind.clone());
    }
}

fn seal_optional_refresh_material<MS>(
    runtime: &BackendOidcModeRuntime<MS>,
    refresh_token: Option<&str>,
) -> Result<Option<SealedRefreshMaterial>, BackendOidcModeRuntimeError>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    refresh_token
        .map(|value| runtime.seal_refresh_token(value))
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
