//! `frontend-oidc` mode runtime.
//!
//! In `frontend-oidc` mode the browser runs the full OIDC flow. The Rust
//! backend provides configuration projection but does not host a
//! client/callback/refresh runtime.
//!
//! `FrontendOidcModeRuntime` exists as the formal runtime landing point so
//! that future capabilities (browser-callback policy enforcement, frontend
//! token handoff validation, address validation, etc.) have a proper owner.

use securitydept_utils::observability::{AuthFlowDiagnosis, DiagnosedResult};

use super::{
    capabilities::FrontendOidcModeCapabilities, config::ResolvedFrontendOidcModeConfig,
    contracts::FrontendOidcModeConfigProjection,
};

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/// Runtime for `frontend-oidc` mode.
///
/// Wraps the resolved config (which already embeds capabilities) and provides
/// helpers for config projection generation. Capabilities are accessed via
/// `self.config.capabilities` — they are carried through from the raw config
/// by [`FrontendOidcModeConfigSource::resolve_all`].
#[derive(Debug, Clone)]
pub struct FrontendOidcModeRuntime {
    config: ResolvedFrontendOidcModeConfig,
}

impl FrontendOidcModeRuntime {
    /// Create a new runtime from a resolved config.
    ///
    /// Emits startup warnings for any unsafe capabilities that are enabled.
    pub fn new(config: ResolvedFrontendOidcModeConfig) -> Self {
        config.capabilities.warn_unsafe();
        Self { config }
    }

    /// Access the resolved config (including capabilities).
    pub fn config(&self) -> &ResolvedFrontendOidcModeConfig {
        &self.config
    }

    /// Access the capability axes.
    pub fn capabilities(&self) -> &FrontendOidcModeCapabilities {
        &self.config.capabilities
    }

    /// Build a config projection for the frontend.
    ///
    /// Capability settings are read from `self.config.capabilities` — e.g.
    /// `client_secret` is only included when `UnsafeFrontendClientSecret` is
    /// enabled.
    ///
    /// # Errors
    ///
    /// Returns an `io::Error` if the claims check script file cannot be read.
    pub async fn config_projection(&self) -> std::io::Result<FrontendOidcModeConfigProjection> {
        self.config_projection_with_diagnosis().await.into_result()
    }

    /// Build a config projection and return a machine-readable diagnosis.
    pub async fn config_projection_with_diagnosis(
        &self,
    ) -> DiagnosedResult<FrontendOidcModeConfigProjection, std::io::Error> {
        let base_diagnosis = AuthFlowDiagnosis::started("projection.config_fetch")
            .field("mode", "frontend_oidc")
            .field("client_id", self.config.oidc_client.client_id.clone())
            .field("pkce_enabled", self.config.oidc_client.pkce_enabled)
            .field(
                "claims_check_script_configured",
                self.config.oidc_client.claims_check_script.is_some(),
            );

        match self.config.to_config_projection().await {
            Ok(projection) => DiagnosedResult::success(
                base_diagnosis
                    .with_outcome(
                        securitydept_utils::observability::AuthFlowDiagnosisOutcome::Succeeded,
                    )
                    .field("has_client_secret", projection.client_secret.is_some())
                    .field(
                        "has_claims_check_script",
                        projection.claims_check_script.is_some(),
                    ),
                projection,
            ),
            Err(error) => DiagnosedResult::failure(
                base_diagnosis
                    .with_outcome(
                        securitydept_utils::observability::AuthFlowDiagnosisOutcome::Failed,
                    )
                    .field("failure_stage", "projection_generation"),
                error,
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};

    use super::*;
    use crate::frontend_oidc_mode::{
        capabilities::UnsafeFrontendClientSecret,
        config::{FrontendOidcModeConfig, FrontendOidcModeConfigSource},
    };

    fn test_runtime() -> FrontendOidcModeRuntime {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("spa-client".to_string()),
            ..Default::default()
        };

        let config = FrontendOidcModeConfig::default()
            .resolve_all(&shared)
            .expect("should resolve");
        FrontendOidcModeRuntime::new(config)
    }

    #[tokio::test]
    async fn runtime_produces_config_projection() {
        let runtime = test_runtime();
        let projection = runtime
            .config_projection()
            .await
            .expect("projection should succeed");
        assert_eq!(projection.client_id, "spa-client");
        assert_eq!(
            projection.well_known_url.as_deref(),
            Some("https://auth.example.com/.well-known/openid-configuration")
        );
        // Default capabilities: client_secret should NOT be exposed
        assert!(projection.client_secret.is_none());
    }

    #[tokio::test]
    async fn runtime_exposes_client_secret_when_capability_enabled() {
        let shared = OidcSharedConfig {
            remote: OAuthProviderRemoteConfig {
                well_known_url: Some(
                    "https://auth.example.com/.well-known/openid-configuration".to_string(),
                ),
                ..Default::default()
            },
            client_id: Some("spa-client".to_string()),
            ..Default::default()
        };

        let config = FrontendOidcModeConfig {
            oidc_client: securitydept_oidc_client::OidcClientRawConfig {
                client_secret: Some("test-secret".to_string()),
                ..Default::default()
            },
            capabilities: FrontendOidcModeCapabilities {
                unsafe_frontend_client_secret: UnsafeFrontendClientSecret::Enabled,
            },
        };
        let resolved = config.resolve_all(&shared).expect("should resolve");
        let runtime = FrontendOidcModeRuntime::new(resolved);
        let projection = runtime
            .config_projection()
            .await
            .expect("projection should succeed");
        assert_eq!(projection.client_secret.as_deref(), Some("test-secret"));
    }

    #[tokio::test]
    async fn runtime_reports_projection_diagnosis() {
        let runtime = test_runtime();
        let diagnosed = runtime.config_projection_with_diagnosis().await;

        assert!(diagnosed.result().is_ok());
        assert_eq!(diagnosed.diagnosis().operation, "projection.config_fetch");
        assert_eq!(diagnosed.diagnosis().outcome.as_str(), "succeeded");
        assert_eq!(diagnosed.diagnosis().fields["mode"], "frontend_oidc");
        assert_eq!(diagnosed.diagnosis().fields["client_id"], "spa-client");
    }
}
