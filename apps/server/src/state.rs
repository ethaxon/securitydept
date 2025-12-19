use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use securitydept_core::config::{AppConfig, ExternalBaseUrl};
use securitydept_core::oidc::OidcClient;
use securitydept_core::session::SessionManager;
use securitydept_core::store::Store;

/// Stored values for a pending OAuth flow (nonce + optional PKCE code_verifier).
#[derive(Clone)]
pub struct PendingOauth {
    pub nonce: String,
    pub code_verifier: Option<String>,
}

/// One-time store for OAuth state -> (nonce, code_verifier) during the login redirect round-trip.
#[derive(Clone, Default)]
pub struct PendingOauthStore {
    inner: Arc<RwLock<HashMap<String, PendingOauth>>>,
}

impl PendingOauthStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Store nonce and optional PKCE code_verifier for the given state (CSRF token).
    pub async fn insert(&self, state: String, nonce: String, code_verifier: Option<String>) {
        self.inner.write().await.insert(
            state,
            PendingOauth {
                nonce,
                code_verifier,
            },
        );
    }

    /// Take the pending data for this state (one-time use). Returns None if state unknown or already used.
    pub async fn take(&self, state: &str) -> Option<PendingOauth> {
        self.inner.write().await.remove(state)
    }
}

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
    /// Pending OAuth flows: state (CSRF) -> nonce, for callback validation.
    pub pending_oauth: PendingOauthStore,
}
