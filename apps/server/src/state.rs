use std::sync::Arc;

pub use securitydept_core::oidc::MokaPendingOauthStore;
use securitydept_core::{
    creds_manage::store::CredsManageStore, oidc::OidcClient, session_context::SessionContextConfig,
};

use crate::{
    config::ServerConfig,
    error::{ServerError, ServerResult},
};

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct ServerState {
    pub config: Arc<ServerConfig>,
    pub store: Arc<CredsManageStore>,
    pub session_config: SessionContextConfig,
    /// None when OIDC is disabled (oidc_enabled = false) for local debugging.
    pub oidc: Option<Arc<OidcClient>>,
    /// Pending OAuth flows: state (CSRF) -> nonce, for callback validation.
    pub pending_oauth: MokaPendingOauthStore,
}

impl ServerState {
    pub fn oidc_client(&self) -> ServerResult<&OidcClient> {
        self.oidc
            .as_deref()
            .ok_or_else(|| ServerError::InvalidConfig {
                message: "OIDC is disabled".to_string(),
            })
    }
}
