// ---------------------------------------------------------------------------
// No-op metadata redemption store for configurations where
// `metadata_delivery = none` (e.g. the Pure preset).
//
// This satisfies the `PendingAuthStateMetadataRedemptionStore` trait bound
// required by `BackendOidcModeRuntime<MS>` without actually storing or
// redeeming anything. The unified runtime only constructs this store when
// `metadata_delivery = redemption`; in all other cases the store is never
// instantiated. If `issue` or `redeem` are called despite that, they return
// a `StoreOperation` error rather than panicking the process.
// ---------------------------------------------------------------------------

use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::{
    MetadataRedemptionId, PendingAuthStateMetadataRedemption,
    PendingAuthStateMetadataRedemptionConfig, PendingAuthStateMetadataRedemptionPayload,
    PendingAuthStateMetadataRedemptionStore, PendingAuthStateMetadataRedemptionStoreError,
};

/// No-op config for [`NeverMetadataRedemptionStore`].
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct NeverMetadataRedemptionConfig;

impl PendingAuthStateMetadataRedemptionConfig for NeverMetadataRedemptionConfig {}

/// A metadata redemption store that is never actually used.
///
/// Required to satisfy the `MS` type parameter of
/// [`BackendOidcModeRuntime`](super::super::runtime::BackendOidcModeRuntime)
/// when `metadata_delivery = none`. The runtime never constructs this store in
/// that configuration.
pub struct NeverMetadataRedemptionStore;

impl PendingAuthStateMetadataRedemptionStore for NeverMetadataRedemptionStore {
    type Config = NeverMetadataRedemptionConfig;

    fn from_config(
        _config: &Self::Config,
    ) -> Result<Self, PendingAuthStateMetadataRedemptionStoreError> {
        Ok(Self)
    }

    fn issue(
        &self,
        _payload: PendingAuthStateMetadataRedemptionPayload,
        _now: DateTime<Utc>,
    ) -> Result<PendingAuthStateMetadataRedemption, PendingAuthStateMetadataRedemptionStoreError>
    {
        Err(
            PendingAuthStateMetadataRedemptionStoreError::StoreOperation {
                message: "NeverMetadataRedemptionStore does not support issue (metadata_delivery \
                          = none is active)"
                    .to_string(),
            },
        )
    }

    fn redeem(
        &self,
        _id: &MetadataRedemptionId,
        _now: DateTime<Utc>,
    ) -> Result<
        Option<PendingAuthStateMetadataRedemptionPayload>,
        PendingAuthStateMetadataRedemptionStoreError,
    > {
        Err(
            PendingAuthStateMetadataRedemptionStoreError::StoreOperation {
                message: "NeverMetadataRedemptionStore does not support redeem (metadata_delivery \
                          = none is active)"
                    .to_string(),
            },
        )
    }
}
