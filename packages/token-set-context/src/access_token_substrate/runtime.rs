use std::sync::Arc;

use securitydept_oauth_resource_server::OAuthResourceServerVerifier;

use super::{
    capabilities::TokenPropagation,
    propagation::{TokenPropagator, TokenPropagatorError},
};

/// Error building an [`AccessTokenSubstrateRuntime`].
#[derive(Debug)]
pub enum AccessTokenSubstrateRuntimeError {
    /// Failed to build the resource-server verifier.
    ResourceServer(securitydept_oauth_resource_server::OAuthResourceServerError),
    /// Failed to build the token propagator.
    TokenPropagator(TokenPropagatorError),
}

impl std::fmt::Display for AccessTokenSubstrateRuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ResourceServer(e) => write!(f, "resource_server: {e}"),
            Self::TokenPropagator(e) => write!(f, "token_propagation: {e}"),
        }
    }
}

impl std::error::Error for AccessTokenSubstrateRuntimeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ResourceServer(e) => Some(e),
            Self::TokenPropagator(e) => Some(e),
        }
    }
}

/// Unified runtime for the access-token substrate layer.
///
/// Owns the token propagator (which may be absent when propagation is
/// disabled). The resource-server verifier lives alongside in
/// [`ServerState`](../../apps/server/src/state) so it can be accessed
/// independently, mirroring the pattern used by `oidc_client`.
#[derive(Clone)]
pub struct AccessTokenSubstrateRuntime {
    token_propagator: Option<Arc<TokenPropagator>>,
}

impl std::fmt::Debug for AccessTokenSubstrateRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccessTokenSubstrateRuntime")
            .field("token_propagator", &self.token_propagator)
            .finish()
    }
}

impl AccessTokenSubstrateRuntime {
    /// **Recommended entry point.** Build the substrate runtime from a
    /// [`ResolvedAccessTokenSubstrateConfig`], returning the runtime together
    /// with an optional resource-server verifier.
    ///
    /// The verifier is returned separately so that the caller can store it
    /// independently (e.g. as `oauth_resource_server_verifier` on
    /// `ServerState`), mirroring the pattern used by `oidc_client`.
    ///
    /// ```text
    /// ResolvedAccessTokenSubstrateConfig
    ///   ──▸ from_resolved_config()
    ///   ──▸ (AccessTokenSubstrateRuntime, Option<Arc<OAuthResourceServerVerifier>>)
    /// ```
    pub async fn from_resolved_config(
        config: &super::config::ResolvedAccessTokenSubstrateConfig,
    ) -> Result<(Self, Option<Arc<OAuthResourceServerVerifier>>), AccessTokenSubstrateRuntimeError>
    {
        let resource_verifier = if config.resource_server.remote.is_discovery_configured() {
            let verifier = OAuthResourceServerVerifier::from_config(config.resource_server.clone())
                .await
                .map_err(AccessTokenSubstrateRuntimeError::ResourceServer)?;
            Some(Arc::new(verifier))
        } else {
            None
        };

        let runtime = Self::new(&config.token_propagation)?;
        Ok((runtime, resource_verifier))
    }

    /// Build from a `TokenPropagation` axis.
    ///
    /// Lower-level constructor — prefer
    /// [`from_resolved_config`](Self::from_resolved_config) when you have a
    /// [`ResolvedAccessTokenSubstrateConfig`].
    pub fn new(
        token_propagation: &TokenPropagation,
    ) -> Result<Self, AccessTokenSubstrateRuntimeError> {
        let token_propagator = match token_propagation {
            TokenPropagation::Enabled { config } => {
                let propagator = TokenPropagator::from_config(config)
                    .map_err(AccessTokenSubstrateRuntimeError::TokenPropagator)?;
                Some(Arc::new(propagator))
            }
            TokenPropagation::Disabled => None,
        };

        Ok(Self { token_propagator })
    }

    /// Access the token propagator, if enabled.
    pub fn token_propagator(&self) -> Option<&Arc<TokenPropagator>> {
        self.token_propagator.as_ref()
    }

    /// Whether propagation is enabled (propagator is present).
    pub fn propagation_enabled(&self) -> bool {
        self.token_propagator.is_some()
    }

    /// Build a forwarder from this runtime and a forwarder config source.
    ///
    /// Returns `None` if propagation is disabled (no propagator available).
    /// Returns `Some(Err(...))` if the forwarder config is present but
    /// construction fails.
    pub fn build_forwarder<C>(&self, config: &C) -> Option<Result<C::Forwarder, C::Error>>
    where
        C: super::forwarder::PropagationForwarderConfigSource,
    {
        if !self.propagation_enabled() {
            return None;
        }
        Some(config.build_forwarder())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::access_token_substrate::{
        capabilities::TokenPropagation,
        propagation::{PropagationDestinationPolicy, TokenPropagatorConfig},
    };

    #[test]
    fn runtime_returns_none_propagator_when_disabled() {
        let runtime = AccessTokenSubstrateRuntime::new(&TokenPropagation::Disabled)
            .expect("should not error");
        assert!(runtime.token_propagator().is_none());
        assert!(!runtime.propagation_enabled());
    }

    #[test]
    fn runtime_returns_some_propagator_when_enabled() {
        let runtime = AccessTokenSubstrateRuntime::new(&TokenPropagation::Enabled {
            config: TokenPropagatorConfig {
                destination_policy: PropagationDestinationPolicy {
                    allowed_targets: vec![],
                    ..Default::default()
                },
                ..Default::default()
            },
        })
        .expect("should not error");
        assert!(runtime.token_propagator().is_some());
        assert!(runtime.propagation_enabled());
    }
}
