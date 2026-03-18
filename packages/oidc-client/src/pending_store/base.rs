use crate::OidcResult;

/// Stored values for a pending OAuth flow (nonce + optional PKCE
/// code_verifier).
#[derive(Clone)]
pub struct PendingOauth {
    pub nonce: String,
    pub code_verifier: Option<String>,
    pub extra_data: Option<serde_json::Value>,
}

pub trait PendingOauthStore {
    /// Store nonce and optional PKCE code_verifier for the given state (CSRF
    /// token).
    fn insert(
        &self,
        state: String,
        nonce: String,
        code_verifier: Option<String>,
        extra_data: Option<serde_json::Value>,
    ) -> impl Future<Output = OidcResult<()>>;
    /// Take the pending data for this state (one-time use). Returns None if
    /// state unknown or already used.
    fn take(&self, state: &str) -> impl Future<Output = OidcResult<Option<PendingOauth>>>;
}
