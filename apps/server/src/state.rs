use std::sync::Arc;

use axum::http::HeaderMap;
pub use securitydept_core::oidc::MokaPendingOauthStore;
use securitydept_core::{
    auth_runtime::{OidcSessionAuthService, TokenSetAuthService},
    creds_manage::store::CredsManageStore,
    oidc::{DefaultOidcClient, DefaultPendingOauthStore, OidcError},
    token_set_context::{DefaultTokenSetContext, MokaPendingAuthStateMetadataRedemptionStore},
};
use url::Url;

use crate::{
    config::ServerConfig,
    error::{ServerError, ServerResult},
};

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct ServerState {
    pub config: Arc<ServerConfig>,
    pub creds_manage_store: Arc<CredsManageStore>,
    pub token_set_context: Arc<DefaultTokenSetContext>,
    /// None when OIDC is disabled (oidc_enabled = false) for local debugging.
    pub oidc: Option<Arc<DefaultOidcClient>>,
}

impl ServerState {
    pub fn session_auth_service(&self) -> OidcSessionAuthService<'_, DefaultPendingOauthStore> {
        OidcSessionAuthService::new(self.oidc.as_deref(), &self.config.session_context, "/")
    }

    pub fn token_set_auth_service(
        &self,
    ) -> ServerResult<
        TokenSetAuthService<'_, MokaPendingOauthStore, MokaPendingAuthStateMetadataRedemptionStore>,
    > {
        let oidc = self.oidc.as_deref().ok_or(ServerError::InvalidConfig {
            message: "TokenSetAuthService requires OIDC to be enabled".to_string(),
        })?;
        Ok(TokenSetAuthService::new(
            oidc,
            &self.token_set_context,
            "/auth/token-set/callback",
        ))
    }

    pub fn external_base_url(&self, headers: &HeaderMap) -> Result<Url, ServerError> {
        self.config
            .server
            .external_base_url
            .resolve_url(headers, &self.config.server.host, self.config.server.port)
            .map_err(|e| OidcError::RedirectUrl { source: e }.into())
    }
}
