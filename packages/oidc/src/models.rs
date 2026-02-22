use serde::{Deserialize, Serialize};
use url::Url;

use openidconnect::{
    AdditionalClaims, CsrfToken, EmptyAdditionalClaims, IdTokenClaims, Nonce, UserInfoClaims,
    core::CoreGenderClaim,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimsCheckResult {
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub claims: serde_json::Value,
}

/// Additional claims we accept from the OIDC provider (open-ended).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraClaims {
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

impl AdditionalClaims for ExtraClaims {}

pub type UserInfoClaimsWithExtra = UserInfoClaims<ExtraClaims, CoreGenderClaim>;
pub type CoreIdTokenClaims = IdTokenClaims<EmptyAdditionalClaims, CoreGenderClaim>;

#[derive(Debug)]
pub struct OidcCodeFlowAuthorizationRequest {
    pub authorization_url: Url,
    pub csrf_token: CsrfToken,
    pub nonce: Nonce,
    pub pkce_verifier_secret: Option<String>,
}

#[derive(Deserialize)]
pub struct OidcCodeCallbackSearchParams {
    pub code: String,
    /// OAuth state (CSRF token); required for callback validation.
    pub state: Option<String>,
}

pub struct OidcCodeExchangeResult {
    pub access_token: String,
    pub id_token: String,
    pub refresh_token: Option<String>,
    pub id_token_claims: CoreIdTokenClaims,
    pub user_info_claims: UserInfoClaimsWithExtra,
}

pub struct OidcCodeCallbackResult {
    pub code: String,
    pub pkce_verifier_secret: Option<String>,
    pub state: Option<String>,
    pub nonce: String,
    pub access_token: String,
    pub id_token: String,
    pub refresh_token: Option<String>,
    pub id_token_claims: CoreIdTokenClaims,
    pub user_info_claims: UserInfoClaimsWithExtra,
    pub claims_check_result: ClaimsCheckResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OidcTokenSet {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
}
