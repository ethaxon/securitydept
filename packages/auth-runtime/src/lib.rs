#[cfg(feature = "basic-auth-context")]
mod basic;
mod error;
#[cfg(feature = "session-context")]
mod session;
#[cfg(feature = "token-set-context")]
mod token_set;

#[cfg(feature = "basic-auth-context")]
pub use basic::BasicAuthContextService;
pub use error::AuthRuntimeError;
#[cfg(feature = "session-context")]
pub use session::{DevSessionAuthService, OidcSessionAuthService, SessionAuthServiceTrait};
#[cfg(feature = "token-set-context")]
pub use token_set::{TokenSetAuthService, TokenSetResourcePrincipal, TokenSetResourceService};
