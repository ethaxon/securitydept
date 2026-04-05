//! OIDC protocol-level principal extraction utilities.
//!
//! These functions extract authenticated principal information from OIDC
//! protocol results (code callback and token refresh). They are
//! protocol-level helpers usable by any backend OIDC mode
//! (`backend-oidc-pure`, `backend-oidc-mediated`, etc.) without
//! mode-specific coupling.
//!
//! # Usage
//!
//! ```rust,ignore
//! use securitydept_oidc_client::auth_state::{
//!     OidcExtractedPrincipal,
//!     extract_principal_from_code_callback,
//!     extract_principal_from_refresh_result,
//! };
//!
//! let principal = extract_principal_from_code_callback(&callback_result);
//! let refreshed = extract_principal_from_refresh_result(&refresh_result);
//! ```

use std::collections::HashMap;

use serde_json::Value;

use crate::{IdTokenClaimsWithExtra, OidcCodeCallbackResult, OidcRefreshTokenResult};

/// Principal information extracted from an OIDC protocol result.
///
/// This is a protocol-level struct: it contains the identity fields that the
/// OIDC flow produces, but it does *not* carry mode-specific metadata such as
/// sealed refresh material or metadata-redemption IDs.  Mode modules convert
/// this into their own `AuthenticatedPrincipal` (or equivalent) as needed.
#[derive(Debug, Clone)]
pub struct OidcExtractedPrincipal {
    pub subject: String,
    pub display_name: String,
    pub picture: Option<String>,
    pub issuer: Option<String>,
    pub claims: HashMap<String, Value>,
}

/// Extract principal from an OIDC authorization-code callback result.
pub fn extract_principal_from_code_callback(
    result: &OidcCodeCallbackResult,
) -> OidcExtractedPrincipal {
    OidcExtractedPrincipal {
        subject: result.id_token_claims.subject().to_string(),
        display_name: result.claims_check_result.display_name.clone(),
        picture: result.claims_check_result.picture.clone(),
        issuer: Some(result.id_token_claims.issuer().url().to_string()),
        claims: result.claims_check_result.claims.clone(),
    }
}

/// Extract principal from an OIDC token refresh result.
///
/// Returns `None` if the refresh response did not include enough identity
/// information (no new ID token claims or claims-check result).
pub fn extract_principal_from_refresh_result(
    result: &OidcRefreshTokenResult,
) -> Option<OidcExtractedPrincipal> {
    let claims_check_result = result.claims_check_result.as_ref()?;
    let id_token_claims = result.id_token_claims.as_ref()?;

    Some(OidcExtractedPrincipal {
        subject: id_token_claims.subject().to_string(),
        display_name: claims_check_result.display_name.clone(),
        picture: claims_check_result.picture.clone(),
        issuer: Some(id_token_claims.issuer().url().to_string()),
        claims: claims_check_result.claims.clone(),
    })
}

/// Extract the issuer URL from an OIDC ID token claims object.
///
/// Useful for building `AuthenticationSource.issuer` from refresh results
/// that may or may not contain full principal data.
pub fn extract_issuer_from_id_token_claims(claims: &IdTokenClaimsWithExtra) -> String {
    claims.issuer().url().to_string()
}

/// Extract the issuer URL from a claims-check result paired with ID token
/// claims, returning `None` if ID token claims are absent.
pub fn extract_issuer_from_refresh_result(result: &OidcRefreshTokenResult) -> Option<String> {
    result
        .id_token_claims
        .as_ref()
        .map(|c| c.issuer().url().to_string())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;

    #[test]
    fn extract_principal_from_refresh_returns_none_without_claims() {
        let result = OidcRefreshTokenResult {
            access_token: "at".to_string(),
            access_token_expiration: Some(Utc::now()),
            id_token: None,
            refresh_token: None,
            id_token_claims: None,
            user_info_claims: None,
            claims_check_result: None,
        };
        assert!(extract_principal_from_refresh_result(&result).is_none());
    }
}
