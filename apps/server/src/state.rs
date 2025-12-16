use std::sync::Arc;

use securitydept_core::config::{AppConfig, ExternalBaseUrl};
use securitydept_core::oidc::OidcClient;
use securitydept_core::session::SessionManager;
use securitydept_core::store::Store;

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub store: Arc<Store>,
    pub sessions: SessionManager,
    /// None when OIDC is disabled (oidc_enabled = false) for local debugging.
    pub oidc: Option<Arc<OidcClient>>,
    /// Optional: loaded claims check script source.
    pub claims_script: Option<Arc<String>>,
    /// Parsed external base URL config (auto or fixed).
    pub external_base_url: ExternalBaseUrl,
}
