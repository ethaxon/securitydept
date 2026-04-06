use securitydept_oauth_provider::OidcSharedConfig;
use securitydept_oauth_resource_server::OAuthResourceServerConfig;
use serde::Deserialize;

use super::capabilities::TokenPropagation;
use crate::orchestration::BackendConfigError;

// ---------------------------------------------------------------------------
// Config source trait
// ---------------------------------------------------------------------------

/// Trait for types that supply access-token substrate configuration components.
///
/// Mirrors [`BackendOidcModeConfigSource`] for the substrate layer.
/// Implementors expose component-config accessors and gain default `resolve_*`
/// helper methods that apply `[oidc]` shared defaults and validate each
/// component.
///
/// [`BackendOidcModeConfigSource`]: crate::backend_oidc_mode::BackendOidcModeConfigSource
pub trait AccessTokenSubstrateConfigSource {
    // --- Component accessors ---

    /// Access the raw `[oauth_resource_server]` config block.
    fn resource_server_config(&self) -> &OAuthResourceServerConfig;

    /// Access the token propagation capability axis.
    fn token_propagation(&self) -> &TokenPropagation;

    // --- Resolve helpers (default implementations) ---

    /// Apply OIDC shared defaults to the resource-server config and validate.
    ///
    /// Delegates to [`OAuthResourceServerConfig::resolve_config`] which handles
    /// `well_known_url`, `client_id`, `client_secret` inheritance from the
    /// `[oidc]` shared block.
    fn resolve_resource_server(
        &self,
        shared: &OidcSharedConfig,
    ) -> Result<OAuthResourceServerConfig, BackendConfigError> {
        let mut rs = self.resource_server_config().clone();
        rs.resolve_config(shared)?;
        Ok(rs)
    }

    /// **Recommended entry point.** Resolve all substrate sub-configs in one
    /// step.
    ///
    /// When an `[oidc]` shared config is provided, resource-server config
    /// inherits provider defaults. When `None`, resource-server config is
    /// returned as-is (valid for deployments without OIDC discovery).
    fn resolve_all(
        &self,
        shared: Option<&OidcSharedConfig>,
    ) -> Result<ResolvedAccessTokenSubstrateConfig, BackendConfigError> {
        let resource_server = if let Some(shared) = shared {
            self.resolve_resource_server(shared)?
        } else {
            self.resource_server_config().clone()
        };

        Ok(ResolvedAccessTokenSubstrateConfig {
            resource_server,
            token_propagation: self.token_propagation().clone(),
        })
    }
}

// ---------------------------------------------------------------------------
// Raw config (TOML / env deserialisable)
// ---------------------------------------------------------------------------

/// Unified configuration for the access-token substrate layer.
///
/// This struct owns the configuration for all cross-mode substrate concerns:
/// resource-server verification and token propagation policy.
///
/// `resource_server` is optional at parse time — when absent it defaults to
/// unconfigured. Call
/// [`resolve_all`](AccessTokenSubstrateConfigSource::resolve_all) with the OIDC
/// shared defaults to produce a [`ResolvedAccessTokenSubstrateConfig`].
#[derive(Debug, Clone, Deserialize, Default)]
pub struct AccessTokenSubstrateConfig {
    /// OAuth resource-server verifier configuration.
    #[serde(default, flatten)]
    pub resource_server: OAuthResourceServerConfig,

    /// Token propagation capability axis.
    #[serde(default)]
    pub token_propagation: TokenPropagation,
}

impl AccessTokenSubstrateConfigSource for AccessTokenSubstrateConfig {
    fn resource_server_config(&self) -> &OAuthResourceServerConfig {
        &self.resource_server
    }

    fn token_propagation(&self) -> &TokenPropagation {
        &self.token_propagation
    }
}

// ---------------------------------------------------------------------------
// Resolved (validated) config
// ---------------------------------------------------------------------------

/// Validated configuration bundle for the access-token substrate.
///
/// Produced by [`AccessTokenSubstrateConfigSource::resolve_all`]. The
/// `resource_server` field has had OIDC shared defaults applied and passed
/// validation.
#[derive(Debug, Clone)]
pub struct ResolvedAccessTokenSubstrateConfig {
    /// OAuth resource-server config with shared defaults applied.
    pub resource_server: OAuthResourceServerConfig,
    /// Token propagation capability axis (pass-through, no extra validation).
    pub token_propagation: TokenPropagation,
}

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};
    use securitydept_oauth_resource_server::OAuthResourceServerIntrospectionConfig;

    use super::*;

    #[test]
    fn resolve_all_inherits_shared_defaults() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("shared-app".to_string()),
            client_secret: Some("shared-secret".to_string()),
            ..Default::default()
        };

        let raw = AccessTokenSubstrateConfig {
            resource_server: OAuthResourceServerConfig {
                introspection: Some(OAuthResourceServerIntrospectionConfig::default()),
                ..Default::default()
            },
            ..Default::default()
        };

        let resolved = raw.resolve_all(Some(&shared)).expect("should resolve");
        assert_eq!(
            resolved
                .resource_server
                .introspection
                .as_ref()
                .unwrap()
                .client_id
                .as_deref(),
            Some("shared-app"),
            "introspection.client_id should inherit from [oidc]"
        );
    }

    #[test]
    fn resolve_all_without_shared_returns_raw() {
        let raw = AccessTokenSubstrateConfig {
            resource_server: OAuthResourceServerConfig::default(),
            token_propagation: TokenPropagation::Disabled,
        };

        let resolved = raw
            .resolve_all(None)
            .expect("should resolve without shared");
        assert!(
            resolved.resource_server.remote.well_known_url.is_none(),
            "no shared defaults should be applied"
        );
        assert!(matches!(
            resolved.token_propagation,
            TokenPropagation::Disabled
        ));
    }

    #[test]
    fn resolve_all_propagation_axis_passes_through() {
        use crate::access_token_substrate::propagation::{
            PropagationDestinationPolicy, TokenPropagatorConfig,
        };

        let raw = AccessTokenSubstrateConfig {
            resource_server: OAuthResourceServerConfig::default(),
            token_propagation: TokenPropagation::Enabled {
                config: TokenPropagatorConfig {
                    destination_policy: PropagationDestinationPolicy {
                        allowed_targets: vec![],
                        ..Default::default()
                    },
                    ..Default::default()
                },
            },
        };

        let resolved = raw.resolve_all(None).expect("should resolve");
        assert!(matches!(
            resolved.token_propagation,
            TokenPropagation::Enabled { .. }
        ));
    }
}
