// ---------------------------------------------------------------------------
// Propagation forwarder trait boundary
// ---------------------------------------------------------------------------
//
// These traits define the formal contract between the access-token substrate
// and any concrete forwarder implementation. The substrate does not own the
// forwarder directly — it only provides `build_forwarder` using these traits.
//
// Traits and the shared error type are unconditionally available. Concrete
// forwarder implementations (e.g. the axum reverse-proxy forwarder) are
// feature-gated.

use std::fmt;

mod error;

pub use error::{PropagationForwarderError, PropagationForwarderResult};

use super::propagation::{PropagatedBearer, PropagationRequestTarget, TokenPropagator};

/// Config-source trait for a propagation forwarder.
///
/// Implementors carry the configuration needed to construct a concrete
/// [`PropagationForwarder`]. The associated types bind the config shape to
/// the forwarder and error types, so
/// `AccessTokenSubstrateRuntime::build_forwarder` can be generic over any
/// forwarder implementation.
pub trait PropagationForwarderConfigSource: fmt::Debug {
    /// The concrete forwarder type produced by this config.
    type Forwarder: PropagationForwarder;
    /// The error type that may occur during forwarder construction.
    type Error: std::error::Error;

    /// Build a forwarder from this configuration.
    fn build_forwarder(&self) -> Result<Self::Forwarder, Self::Error>;
}

/// Runtime trait for a propagation forwarder.
///
/// Concrete implementations (e.g. `AxumReverseProxyPropagationForwarder`)
/// implement `forward` to handle the transport-level forwarding of a
/// validated bearer token to a downstream target.
pub trait PropagationForwarder: fmt::Debug + Clone + Send + Sync + 'static {
    /// The HTTP body type used for both request and response.
    type Body: Send + 'static;

    /// Validate and forward a bearer token to a downstream propagation target.
    ///
    /// The `propagator` handles destination-policy validation and
    /// authorization header construction. The concrete implementation is
    /// responsible for the actual HTTP transport.
    fn forward(
        &self,
        propagator: &TokenPropagator,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
        request: http::Request<Self::Body>,
    ) -> impl Future<Output = Result<http::Response<Self::Body>, PropagationForwarderError>> + Send;
}

// ---------------------------------------------------------------------------
// Concrete forwarder implementations (feature-gated)
// ---------------------------------------------------------------------------

#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
mod axum_reverse_proxy;

#[cfg(feature = "axum-reverse-proxy-propagation-forwarder")]
pub use axum_reverse_proxy::{
    AxumReverseProxyPropagationForwarder, AxumReverseProxyPropagationForwarderConfig,
};
