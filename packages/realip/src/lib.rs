mod access;
pub mod config;
pub mod error;
pub mod extension;

mod builtins;
mod providers;
mod resolve;

pub use access::{RealIpAccessConfig, RealIpAccessManager};
pub use config::RealIpResolveConfig;
pub use error::{RealIpError, RealIpResult};
pub use providers::{ProviderRegistry, ProviderSnapshot};
pub use resolve::{RealIpResolver, ResolvedClientIp, ResolvedSourceKind, TransportContext};
