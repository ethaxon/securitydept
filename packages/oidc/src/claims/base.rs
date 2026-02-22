use crate::{ClaimsCheckResult, OidcError, OidcResult, UserInfoClaimsWithExtra};

pub trait ClaimsChecker {
    fn check_claims(
        &self,
        claims: &UserInfoClaimsWithExtra,
    ) -> impl Future<Output = OidcResult<ClaimsCheckResult>>;
}

pub struct DefaultClaimsChecker;

impl ClaimsChecker for DefaultClaimsChecker {
    async fn check_claims(
        &self,
        claims: &UserInfoClaimsWithExtra,
    ) -> OidcResult<ClaimsCheckResult> {
        let name = claims
            .preferred_username()
            .map(|v| v.to_string())
            .or_else(|| {
                claims
                    .nickname()
                    .and_then(|v| v.get(None).map(|v| v.to_string()))
            })
            .unwrap_or_else(|| {
                let sub = claims.subject().to_string();
                if sub.is_empty() {
                    "Unknown".to_string()
                } else {
                    sub
                }
            });
        let picture = claims
            .picture()
            .and_then(|v| v.get(None).map(|v| v.to_string()));
        let transformed_claims = serde_json::to_value(claims).map_err(|e| OidcError::Claims {
            message: format!("Failed to convert claims to JSON: {e}"),
        })?;
        Ok(ClaimsCheckResult {
            display_name: name,
            picture,
            claims: transformed_claims,
        })
    }
}
