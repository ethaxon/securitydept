use std::time::Duration;

use moka::future::Cache;
use serde::Deserialize;

use crate::{
    OidcResult,
    pending_store::{PendingOauthStore, base::PendingOauth},
};

/// Configuration for PendingOauthStore.
#[derive(Debug, Clone, Deserialize)]
pub struct MokaPendingOauthStoreConfig {
    /// Time-to-live for pending OAuth entries.
    #[serde(default = "default_ttl", with = "humantime_serde")]
    pub ttl: Duration,
    /// Maximum number of entries in the cache.
    #[serde(default = "default_max_capacity")]
    pub max_capacity: u64,
}

fn default_ttl() -> Duration {
    Duration::from_secs(300) // 5 minutes
}

fn default_max_capacity() -> u64 {
    1000
}

impl Default for MokaPendingOauthStoreConfig {
    fn default() -> Self {
        Self {
            ttl: default_ttl(),
            max_capacity: default_max_capacity(),
        }
    }
}

/// One-time store for OAuth state -> (nonce, code_verifier) during the login
/// redirect round-trip.
#[derive(Clone)]
pub struct MokaPendingOauthStore {
    inner: Cache<String, PendingOauth>,
}

impl MokaPendingOauthStore {
    pub fn from_config_opt(config: Option<&MokaPendingOauthStoreConfig>) -> Self {
        if let Some(config) = config {
            Self::from_config(config)
        } else {
            Self::default()
        }
    }

    pub fn from_config(config: &MokaPendingOauthStoreConfig) -> Self {
        let inner = Cache::builder()
            .time_to_live(config.ttl)
            .max_capacity(config.max_capacity)
            .build();
        Self { inner }
    }
}

impl PendingOauthStore for MokaPendingOauthStore {
    async fn insert(
        &self,
        state: String,
        nonce: String,
        code_verifier: Option<String>,
        extra_data: Option<serde_json::Value>,
    ) -> OidcResult<()> {
        self.inner
            .insert(
                state,
                PendingOauth {
                    nonce,
                    code_verifier,
                    extra_data,
                },
            )
            .await;

        Ok(())
    }

    async fn take(&self, state: &str) -> OidcResult<Option<PendingOauth>> {
        Ok(self.inner.remove(state).await)
    }
}

impl Default for MokaPendingOauthStore {
    fn default() -> Self {
        Self::from_config(&MokaPendingOauthStoreConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_insert_and_take() -> OidcResult<()> {
        let store = MokaPendingOauthStore::default();
        store
            .insert(
                "state1".to_string(),
                "nonce1".to_string(),
                Some("verifier1".to_string()),
                None,
            )
            .await?;

        let result = store.take("state1").await?.unwrap();
        assert_eq!(result.nonce, "nonce1");
        assert_eq!(result.code_verifier, Some("verifier1".to_string()));
        assert!(result.extra_data.is_none());

        // Should be None after take (one-time use)
        assert!(store.take("state1").await?.is_none());

        Ok(())
    }

    #[tokio::test]
    async fn test_unknown_state() -> OidcResult<()> {
        let store = MokaPendingOauthStore::default();
        assert!(store.take("unknown").await?.is_none());
        Ok(())
    }
}
