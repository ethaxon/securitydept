use serde::Deserialize;

use crate::OidcResult;

/// Stored values for a pending OAuth flow (nonce + optional PKCE
/// code_verifier).
#[derive(Clone)]
pub struct PendingOauth {
    pub nonce: String,
    pub code_verifier: Option<String>,
    pub extra_data: Option<serde_json::Value>,
}

pub trait PendingOauthStoreConfig:
    Sized + for<'de> Deserialize<'de> + Clone + Default + Send + Sync
{
}

pub trait PendingOauthStore: Sized + Send + Sync {
    type Config: PendingOauthStoreConfig;

    fn from_config(config: &Self::Config) -> Self;
    fn from_config_opt(config_opt: Option<&Self::Config>) -> Self {
        if let Some(config) = config_opt {
            Self::from_config(config)
        } else {
            Self::from_config(&Self::Config::default())
        }
    }
    /// Store nonce and optional PKCE code_verifier for the given state (CSRF
    /// token).
    fn insert(
        &self,
        state: String,
        nonce: String,
        code_verifier: Option<String>,
        extra_data: Option<serde_json::Value>,
    ) -> impl Future<Output = OidcResult<()>> + Send;
    /// Take the pending data for this state (one-time use). Returns None if
    /// state unknown or already used.
    fn take(&self, state: &str) -> impl Future<Output = OidcResult<Option<PendingOauth>>> + Send;
}
