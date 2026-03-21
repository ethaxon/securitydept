use crate::{MokaPendingOauthStore, MokaPendingOauthStoreConfig, OidcClient, OidcClientConfig};

pub type DefaultPendingOauthStore = MokaPendingOauthStore;
pub type DefaultPendingOauthStoreConfig = MokaPendingOauthStoreConfig;
pub type DefaultOidcClientConfig = OidcClientConfig<DefaultPendingOauthStoreConfig>;
pub type DefaultOidcClient = OidcClient<DefaultPendingOauthStore>;
