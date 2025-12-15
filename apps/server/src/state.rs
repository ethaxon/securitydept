use std::sync::Arc;

use securitydept_core::config::AppConfig;
use securitydept_core::oidc::OidcClient;
use securitydept_core::session::SessionManager;
use securitydept_core::store::Store;

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub store: Arc<Store>,
    pub sessions: SessionManager,
    pub oidc: Arc<OidcClient>,
    /// Optional: loaded claims check script source.
    pub claims_script: Option<Arc<String>>,
}
