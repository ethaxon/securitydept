pub mod claims;
pub mod client;
pub mod config;
pub mod error;
pub mod models;
pub mod pending_store;
#[cfg(feature = "axum")]
pub mod routes;

pub use client::OidcClient;
pub use config::OidcConfig;
pub use error::{OidcError, OidcResult};
pub use securitydept_oauth_provider::{OAuthProviderConfig, OAuthProviderRuntime};
pub use models::{
    ClaimsCheckResult, ExtraOidcClaims, IdTokenClaimsWithExtra, OidcCodeCallbackSearchParams,
    OidcCodeExchangeResult, OidcCodeFlowAuthorizationRequest, OidcTokenSet,
    UserInfoClaimsWithExtra,
};
#[cfg(feature = "moka-pending-store")]
pub use pending_store::{MokaPendingOauthStore, MokaPendingOauthStoreConfig};
pub use pending_store::{PendingOauth, PendingOauthStore};
