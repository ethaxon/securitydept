use std::time::Duration;

use chrono::{DateTime, Utc};
#[cfg(feature = "moka-pending-store")]
use moka::sync::Cache;
use serde::{Deserialize, Serialize};
use snafu::Snafu;
use uuid::Uuid;

use crate::{AuthStateMetadataDelta, AuthStateMetadataSnapshot};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct MetadataRedemptionId(String);

impl MetadataRedemptionId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn generate() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "metadata", rename_all = "snake_case")]
pub enum PendingAuthStateMetadataRedemptionPayload {
    Snapshot(AuthStateMetadataSnapshot),
    Delta(AuthStateMetadataDelta),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingAuthStateMetadataRedemption {
    pub id: MetadataRedemptionId,
    pub payload: PendingAuthStateMetadataRedemptionPayload,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingAuthStateMetadataRedemptionConfig {
    #[serde(default = "default_metadata_redemption_ttl", with = "humantime_serde")]
    pub ttl: Duration,
    #[serde(default = "default_metadata_redemption_max_capacity")]
    pub max_capacity: u64,
}

impl Default for PendingAuthStateMetadataRedemptionConfig {
    fn default() -> Self {
        Self {
            ttl: default_metadata_redemption_ttl(),
            max_capacity: default_metadata_redemption_max_capacity(),
        }
    }
}

fn default_metadata_redemption_ttl() -> Duration {
    Duration::from_secs(60)
}

fn default_metadata_redemption_max_capacity() -> u64 {
    1000
}

#[derive(Debug, Snafu)]
pub enum PendingAuthStateMetadataRedemptionStoreError {
    #[snafu(display("metadata redemption store operation failed: {message}"))]
    StoreOperation { message: String },
}

pub trait PendingAuthStateMetadataRedemptionStore: Send + Sync {
    fn issue(
        &self,
        payload: PendingAuthStateMetadataRedemptionPayload,
        now: DateTime<Utc>,
    ) -> Result<PendingAuthStateMetadataRedemption, PendingAuthStateMetadataRedemptionStoreError>;

    fn redeem(
        &self,
        id: &MetadataRedemptionId,
        now: DateTime<Utc>,
    ) -> Result<
        Option<PendingAuthStateMetadataRedemptionPayload>,
        PendingAuthStateMetadataRedemptionStoreError,
    >;
}

#[cfg(feature = "moka-pending-store")]
#[derive(Debug, Clone)]
pub struct MokaPendingAuthStateMetadataRedemptionStore {
    config: PendingAuthStateMetadataRedemptionConfig,
    entries: Cache<String, PendingAuthStateMetadataRedemption>,
}

#[cfg(feature = "moka-pending-store")]
impl MokaPendingAuthStateMetadataRedemptionStore {
    pub fn new(config: PendingAuthStateMetadataRedemptionConfig) -> Self {
        Self {
            entries: Cache::builder()
                .time_to_live(config.ttl)
                .max_capacity(config.max_capacity)
                .build(),
            config,
        }
    }
}

#[cfg(feature = "moka-pending-store")]
impl Default for MokaPendingAuthStateMetadataRedemptionStore {
    fn default() -> Self {
        Self::new(PendingAuthStateMetadataRedemptionConfig::default())
    }
}

#[cfg(feature = "moka-pending-store")]
impl PendingAuthStateMetadataRedemptionStore for MokaPendingAuthStateMetadataRedemptionStore {
    fn issue(
        &self,
        payload: PendingAuthStateMetadataRedemptionPayload,
        now: DateTime<Utc>,
    ) -> Result<PendingAuthStateMetadataRedemption, PendingAuthStateMetadataRedemptionStoreError>
    {
        let redemption = PendingAuthStateMetadataRedemption {
            id: MetadataRedemptionId::generate(),
            payload,
            expires_at: now
                + chrono::TimeDelta::from_std(self.config.ttl).map_err(|e| {
                    PendingAuthStateMetadataRedemptionStoreError::StoreOperation {
                        message: format!("failed to compute metadata redemption expiration: {e}"),
                    }
                })?,
        };

        self.entries
            .insert(redemption.id.expose().to_string(), redemption.clone());
        Ok(redemption)
    }

    fn redeem(
        &self,
        id: &MetadataRedemptionId,
        _now: DateTime<Utc>,
    ) -> Result<
        Option<PendingAuthStateMetadataRedemptionPayload>,
        PendingAuthStateMetadataRedemptionStoreError,
    > {
        let redemption = match self.entries.get(id.expose()) {
            Some(redemption) => redemption,
            None => return Ok(None),
        };
        self.entries.invalidate(id.expose());

        Ok(Some(redemption.payload))
    }
}
