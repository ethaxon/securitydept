use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
pub struct SerializedPendingAuthStateMetadataRedemption {
    pub id: MetadataRedemptionId,
    pub payload: Value,
    pub expires_at: DateTime<Utc>,
}

pub trait PendingAuthStateMetadataRedemptionConfig:
    Clone + for<'de> Deserialize<'de> + Default
{
}

#[derive(Debug, Snafu)]
pub enum PendingAuthStateMetadataRedemptionStoreError {
    #[snafu(display("metadata redemption store operation failed: {message}"))]
    StoreOperation { message: String },
}

pub trait PendingAuthStateMetadataRedemptionStore: Send + Sync + Sized {
    type Config: PendingAuthStateMetadataRedemptionConfig;

    fn from_config(
        config: &Self::Config,
    ) -> Result<Self, PendingAuthStateMetadataRedemptionStoreError>;

    fn from_config_opt(
        config: Option<&Self::Config>,
    ) -> Result<Self, PendingAuthStateMetadataRedemptionStoreError> {
        match config {
            Some(config) => Self::from_config(config),
            None => Self::from_config(&Self::Config::default()),
        }
    }

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
