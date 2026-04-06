pub mod config;
pub mod error;
pub mod models;
pub mod verifier;

#[cfg(feature = "jwe")]
pub use config::OAuthResourceServerJweConfig;
pub use config::{OAuthResourceServerConfig, OAuthResourceServerIntrospectionConfig};
pub use error::{OAuthResourceServerError, OAuthResourceServerResult};
#[cfg(feature = "jwe")]
pub use models::LocalJweDecryptionKeySet;
pub use models::{
    OAuthResourceServerMetadata, ResourceTokenPrincipal, VerificationPolicy, VerifiedAccessToken,
    VerifiedOpaqueToken, VerifiedToken,
};
// Re-export the remote-config struct so downstream crates can construct an
// `OAuthResourceServerConfig` without adding a direct dep on oauth-provider.
pub use securitydept_oauth_provider::OAuthProviderRemoteConfig;
pub use verifier::OAuthResourceServerVerifier;
