mod access;
pub mod config;
pub mod error;
pub mod extension;

mod builtins;
mod graph;
mod node_registry;
mod resolve;

pub use access::{RealIpAccessConfig, RealIpAccessManager};
pub use config::RealIpResolveConfig;
pub use error::{RealIpError, RealIpResult};
pub use node_registry::{CidrNodeRegistry, CidrNodeSnapshot};
pub use resolve::{
    RealIpRejectionReason, RealIpResolutionStatus, RealIpResolver, ResolvedClientIp,
    ResolvedInputKind, ResolvedNodeMatch, TransportContext,
};
