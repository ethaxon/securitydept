mod access;
pub mod config;
pub mod error;
pub mod extension;

mod builtins;
mod graph;
mod node_registry;
mod resolve;
mod trusted_bridge;

pub use access::{RealIpAccessConfig, RealIpAccessManager};
pub use config::RealIpResolveConfig;
pub use error::{RealIpError, RealIpResult};
pub use node_registry::{CidrNodeRegistry, CidrNodeSnapshot};
pub use resolve::{
    RealIpRejectionReason, RealIpResolutionStatus, RealIpResolver, ResolvedClientIp,
    ResolvedInputKind, ResolvedNodeMatch, TransportContext,
};
pub use trusted_bridge::generate_trusted_bridge_secret_bearer;
