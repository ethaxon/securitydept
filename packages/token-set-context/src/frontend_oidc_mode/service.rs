//! `frontend-oidc` mode service.
//!
//! [`FrontendOidcModeService`] is the route-facing service for `frontend-oidc`
//! mode, mirroring the role that [`BackendOidcModeAuthService`] plays for
//! `backend-oidc`.
//!
//! Currently it wraps [`FrontendOidcModeRuntime`] and provides helpers for
//! building config projections. Future capabilities (e.g. frontend token
//! handoff validation) will be added here.

use securitydept_utils::observability::DiagnosedResult;

use super::{contracts::FrontendOidcModeConfigProjection, runtime::FrontendOidcModeRuntime};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// Route-facing service for `frontend-oidc` mode.
///
/// This is the formal entry point for server routes that need to serve
/// `frontend-oidc` mode concerns (config projection endpoints, etc.).
#[derive(Debug, Clone)]
pub struct FrontendOidcModeService {
    runtime: FrontendOidcModeRuntime,
}

impl FrontendOidcModeService {
    /// Create a new service from a runtime.
    pub fn new(runtime: FrontendOidcModeRuntime) -> Self {
        Self { runtime }
    }

    /// Access the underlying runtime.
    pub fn runtime(&self) -> &FrontendOidcModeRuntime {
        &self.runtime
    }

    /// Build a config projection for the frontend.
    ///
    /// # Errors
    ///
    /// Returns an `io::Error` if the claims check script file cannot be read.
    pub async fn config_projection(&self) -> std::io::Result<FrontendOidcModeConfigProjection> {
        self.runtime.config_projection().await
    }

    /// Build a config projection and return a machine-readable diagnosis.
    pub async fn config_projection_with_diagnosis(
        &self,
    ) -> DiagnosedResult<FrontendOidcModeConfigProjection, std::io::Error> {
        self.runtime.config_projection_with_diagnosis().await
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use securitydept_oauth_provider::{OAuthProviderRemoteConfig, OidcSharedConfig};

    use super::*;
    use crate::frontend_oidc_mode::config::{FrontendOidcModeConfig, FrontendOidcModeConfigSource};

    fn test_service() -> FrontendOidcModeService {
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
        let runtime = FrontendOidcModeRuntime::new(config);
        FrontendOidcModeService::new(runtime)
    }

    #[tokio::test]
    async fn service_delegates_to_runtime() {
        let service = test_service();
        let projection = service
            .config_projection()
            .await
            .expect("projection should succeed");
        assert_eq!(projection.client_id, "spa-client");
    }
}
