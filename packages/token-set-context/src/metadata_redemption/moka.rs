use std::time::Duration;

use chrono::{DateTime, Utc};
use moka::sync::Cache;
use serde::{Deserialize, Serialize};

use crate::{
    MetadataRedemptionId, PendingAuthStateMetadataRedemption,
    PendingAuthStateMetadataRedemptionConfig, PendingAuthStateMetadataRedemptionPayload,
    PendingAuthStateMetadataRedemptionStore, PendingAuthStateMetadataRedemptionStoreError,
    SerializedPendingAuthStateMetadataRedemption,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MokaPendingAuthStateMetadataRedemptionConfig {
    #[serde(default = "default_metadata_redemption_ttl", with = "humantime_serde")]
    pub ttl: Duration,
    #[serde(default = "default_metadata_redemption_max_capacity")]
    pub max_capacity: u64,
}

impl Default for MokaPendingAuthStateMetadataRedemptionConfig {
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

impl PendingAuthStateMetadataRedemptionConfig for MokaPendingAuthStateMetadataRedemptionConfig {}

#[derive(Debug, Clone)]
pub struct MokaPendingAuthStateMetadataRedemptionStore {
    config: MokaPendingAuthStateMetadataRedemptionConfig,
    entries: Cache<String, SerializedPendingAuthStateMetadataRedemption>,
}

impl PendingAuthStateMetadataRedemptionStore for MokaPendingAuthStateMetadataRedemptionStore {
    type Config = MokaPendingAuthStateMetadataRedemptionConfig;

    fn from_config(
        config: &Self::Config,
    ) -> Result<Self, PendingAuthStateMetadataRedemptionStoreError> {
        Ok(Self {
            config: config.clone(),
            entries: Cache::builder()
                .time_to_live(config.ttl)
                .max_capacity(config.max_capacity)
                .build(),
        })
    }

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
        let serialized = SerializedPendingAuthStateMetadataRedemption {
            id: redemption.id.clone(),
            payload: serde_json::to_value(&redemption.payload).map_err(|e| {
                PendingAuthStateMetadataRedemptionStoreError::StoreOperation {
                    message: format!("failed to serialize metadata redemption payload: {e}"),
                }
            })?,
            expires_at: redemption.expires_at,
        };

        self.entries
            .insert(redemption.id.expose().to_string(), serialized);
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

        serde_json::from_value(redemption.payload.clone())
            .map(Some)
            .map_err(
                |e| PendingAuthStateMetadataRedemptionStoreError::StoreOperation {
                    message: format!("failed to deserialize metadata redemption payload: {e}"),
                },
            )
    }
}
