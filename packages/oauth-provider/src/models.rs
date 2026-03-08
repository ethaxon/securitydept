use std::collections::HashMap;

use openidconnect::{
    AdditionalProviderMetadata, AuthUrl, DeviceAuthorizationUrl, IntrospectionUrl, IssuerUrl,
    JsonWebKeySetUrl, ProviderMetadata, ResponseTypes, RevocationUrl, TokenUrl, UserInfoUrl,
    core::{
        CoreAuthDisplay, CoreClientAuthMethod, CoreClaimName, CoreClaimType, CoreGrantType,
        CoreJsonWebKey, CoreJweContentEncryptionAlgorithm, CoreJweKeyManagementAlgorithm,
        CoreJwsSigningAlgorithm, CoreResponseMode, CoreResponseType, CoreSubjectIdentifierType,
    },
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtraProviderMetadata {
    pub introspection_endpoint: Option<String>,
    pub revocation_endpoint: Option<String>,
    pub device_authorization_endpoint: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl AdditionalProviderMetadata for ExtraProviderMetadata {}

pub type ProviderMetadataWithExtra = ProviderMetadata<
    ExtraProviderMetadata,
    CoreAuthDisplay,
    CoreClientAuthMethod,
    CoreClaimName,
    CoreClaimType,
    CoreGrantType,
    CoreJweContentEncryptionAlgorithm,
    CoreJweKeyManagementAlgorithm,
    CoreJsonWebKey,
    CoreResponseMode,
    CoreResponseType,
    CoreSubjectIdentifierType,
>;

#[derive(Debug, Clone)]
pub struct OAuthProviderMetadata {
    pub issuer: IssuerUrl,
    pub authorization_endpoint: Option<AuthUrl>,
    pub token_endpoint: Option<TokenUrl>,
    pub userinfo_endpoint: Option<UserInfoUrl>,
    pub introspection_endpoint: Option<IntrospectionUrl>,
    pub revocation_endpoint: Option<RevocationUrl>,
    pub device_authorization_endpoint: Option<DeviceAuthorizationUrl>,
    pub jwks_uri: JsonWebKeySetUrl,
    pub jwks: openidconnect::core::CoreJsonWebKeySet,
    pub token_endpoint_auth_methods_supported: Option<Vec<CoreClientAuthMethod>>,
    pub response_types_supported: Vec<ResponseTypes<CoreResponseType>>,
    pub subject_types_supported: Vec<CoreSubjectIdentifierType>,
    pub id_token_signing_alg_values_supported: Vec<CoreJwsSigningAlgorithm>,
    pub userinfo_signing_alg_values_supported: Option<Vec<CoreJwsSigningAlgorithm>>,
    pub additional_metadata: ExtraProviderMetadata,
}

