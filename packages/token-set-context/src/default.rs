use crate::{
    MokaPendingAuthStateMetadataRedemptionConfig, MokaPendingAuthStateMetadataRedemptionStore,
    TokenSetContext, TokenSetContextConfig,
};

pub type DefaultPendingAuthStateMetadataRedemptionStore =
    MokaPendingAuthStateMetadataRedemptionStore;
pub type DefaultPendingAuthStateMetadataRedemptionConfig =
    MokaPendingAuthStateMetadataRedemptionConfig;
pub type DefaultTokenSetContext = TokenSetContext<DefaultPendingAuthStateMetadataRedemptionStore>;
pub type DefaultTokenSetContextConfig =
    TokenSetContextConfig<DefaultPendingAuthStateMetadataRedemptionConfig>;
