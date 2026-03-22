mod context;
mod error;
#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
mod forwarder;
mod metadata_redemption;
mod models;
mod oidc;
mod propagation;
mod redirect;
mod refresh_material;
#[cfg(test)]
mod tests;
mod transport;

pub use context::{
    TokenSetContext, TokenSetContextCodeCallbackResult, TokenSetContextConfig,
    TokenSetContextTokenRefreshResult,
};
pub use error::{TokenSetContextError, TokenSetContextResult};
#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
pub use forwarder::{
    AxumReverseProxyPropagationForwarder, AxumReverseProxyPropagationForwarderConfig,
    AxumReverseProxyPropagationForwarderError, AxumReverseProxyPropagationForwarderResult,
};
pub use metadata_redemption::{
    MetadataRedemptionId, PendingAuthStateMetadataRedemption,
    PendingAuthStateMetadataRedemptionConfig, PendingAuthStateMetadataRedemptionPayload,
    PendingAuthStateMetadataRedemptionStore, PendingAuthStateMetadataRedemptionStoreError,
    SerializedPendingAuthStateMetadataRedemption,
};
#[cfg(feature = "moka-pending-store")]
pub use metadata_redemption::{
    MokaPendingAuthStateMetadataRedemptionConfig, MokaPendingAuthStateMetadataRedemptionStore,
};
pub use models::{
    AuthStateDelta, AuthStateMetadataDelta, AuthStateMetadataSnapshot, AuthStateSnapshot,
    AuthTokenDelta, AuthTokenSnapshot, AuthenticatedPrincipal, AuthenticationSource,
    AuthenticationSourceKind, CurrentAuthStateMetadataSnapshotPartial,
    CurrentAuthenticationSourcePartial,
};
pub use oidc::OidcAuthStateOptions;
pub use propagation::{
    AllowedPropagationTarget, BearerPropagationPolicy, DEFAULT_PROPAGATION_HEADER_NAME,
    PropagatedBearer, PropagatedTokenValidationConfig, PropagationDestinationPolicy,
    PropagationDirective, PropagationNodeTargetResolver, PropagationRequestTarget,
    PropagationScheme, TokenPropagator, TokenPropagatorConfig, TokenPropagatorError,
    TokenPropagatorResult,
};
pub use redirect::{
    TokenSetRedirectUriConfig, TokenSetRedirectUriError, TokenSetRedirectUriResolver,
    TokenSetRedirectUriRule,
};
pub use refresh_material::{
    AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector, RefreshMaterialError,
    RefreshMaterialProtector, SealedRefreshMaterial,
};
pub use transport::{
    AuthTokenDeltaRedirectFragment, AuthTokenSnapshotRedirectFragment, MetadataRedemptionRequest,
    MetadataRedemptionResponse, TokenRefreshPayload, TokenSetAuthorizeQuery,
};
