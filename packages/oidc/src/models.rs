use serde::{Deserialize, Serialize};
use url::Url;

use openidconnect::{
    AdditionalClaims, EndpointMaybeSet, EndpointSet, UserInfoClaims,
    core::{CoreClient, CoreGenderClaim},
};

/// Additional claims we accept from the OIDC provider (open-ended).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraClaims {
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

impl AdditionalClaims for ExtraClaims {}

/// Type alias for the discovered client *without* a fixed redirect URI.
pub type DiscoveredClient = CoreClient<
    EndpointSet,                   // HasAuthUrl
    openidconnect::EndpointNotSet, // HasDeviceAuthUrl
    openidconnect::EndpointNotSet, // HasIntrospectionUrl
    openidconnect::EndpointNotSet, // HasRevocationUrl
    EndpointMaybeSet,              // HasTokenUrl
    EndpointMaybeSet,              // HasUserInfoUrl
>;

/// Type alias for the discovered client *with* a fixed redirect URI.
pub type DiscoveredClientWithRedirect = CoreClient<
    EndpointSet,                   // HasAuthUrl
    openidconnect::EndpointNotSet, // HasDeviceAuthUrl
    openidconnect::EndpointNotSet, // HasIntrospectionUrl
    openidconnect::EndpointNotSet, // HasRevocationUrl
    EndpointMaybeSet,              // HasTokenUrl
    EndpointMaybeSet,              // HasUserInfoUrl
>;

pub type UserInfoClaimsWithExtra = UserInfoClaims<ExtraClaims, CoreGenderClaim>;

#[derive(Debug)]
pub struct OidcCodeFlowAuthorizationRequest {
    pub authorization_url: Url,
    pub csrf_token: String,
    pub nonce: String,
    pub pkce_verifier_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OidcTokenSet {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
}
