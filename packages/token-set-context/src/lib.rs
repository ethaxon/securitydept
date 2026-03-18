mod context;
mod coordinator;
mod metadata_redemption;
mod models;
mod oidc;
mod propagation;
mod redirect;
mod refresh_material;
#[cfg(test)]
mod tests;
mod transport;

pub use context::{TokenSetContext, TokenSetContextConfig, TokenSetContextError};
pub use coordinator::{
    AuthStateCoordinator, AuthStateCoordinatorError, CodeCallbackCoordinationResult,
    TokenRefreshCoordinationResult,
};
#[cfg(feature = "moka-pending-store")]
pub use metadata_redemption::MokaPendingAuthStateMetadataRedemptionStore;
pub use metadata_redemption::{
    MetadataRedemptionId, PendingAuthStateMetadataRedemption,
    PendingAuthStateMetadataRedemptionConfig, PendingAuthStateMetadataRedemptionPayload,
    PendingAuthStateMetadataRedemptionStore, PendingAuthStateMetadataRedemptionStoreError,
};
pub use models::{
    AuthStateDelta, AuthStateMetadataDelta, AuthStateMetadataSnapshot, AuthStateSnapshot,
    AuthTokenDelta, AuthTokenSnapshot, AuthenticatedPrincipal, AuthenticationSource,
    AuthenticationSourceKind,
};
pub use oidc::OidcAuthStateOptions;
pub use propagation::{
    BearerPropagationPolicy, TokenPropagator, TokenPropagatorConfig, TokenPropagatorError,
};
pub use redirect::{TokenSetRedirectUriConfig, TokenSetRedirectUriError, TokenSetRedirectUriRule};
pub use refresh_material::{
    AeadRefreshMaterialProtector, PassthroughRefreshMaterialProtector, RefreshMaterialError,
    RefreshMaterialProtector, SealedRefreshMaterial,
};
pub use transport::{
    AuthTokenDeltaRedirectFragment, AuthTokenSnapshotRedirectFragment, MetadataRedemptionRequest,
    MetadataRedemptionResponse, TokenRefreshPayload, TokenSetAuthorizeQuery,
};
