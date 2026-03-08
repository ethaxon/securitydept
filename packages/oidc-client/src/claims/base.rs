use crate::{
    ClaimsCheckResult, IdTokenClaimsWithExtra, OidcError, OidcResult, UserInfoClaimsWithExtra,
};

pub trait ClaimsChecker {
    fn check_claims(
        &self,
        id_token_claims: &IdTokenClaimsWithExtra,
        user_info_claims: Option<&UserInfoClaimsWithExtra>,
    ) -> impl Future<Output = OidcResult<ClaimsCheckResult>>;
}

pub struct DefaultClaimsChecker;

impl ClaimsChecker for DefaultClaimsChecker {
    async fn check_claims(
        &self,
        id_token_claims: &IdTokenClaimsWithExtra,
        user_info_claims: Option<&UserInfoClaimsWithExtra>,
    ) -> OidcResult<ClaimsCheckResult> {
        let name = user_info_claims
            .and_then(|c| c.preferred_username())
            .or_else(|| id_token_claims.preferred_username())
            .map(|v| v.to_string())
            .or_else(|| {
                user_info_claims
                    .and_then(|c| c.nickname())
                    .or_else(|| id_token_claims.nickname())
                    .and_then(|v| v.get(None).map(|v| v.to_string()))
            })
            .unwrap_or_else(|| {
                let sub = user_info_claims
                    .map(|c| c.subject())
                    .unwrap_or_else(|| id_token_claims.subject())
                    .to_string();
                if sub.is_empty() {
                    "Unknown".to_string()
                } else {
                    sub
                }
            });
        let picture = user_info_claims
            .and_then(|c| c.picture())
            .or_else(|| id_token_claims.picture())
            .and_then(|v| v.get(None).map(|v| v.to_string()));
        let id_token_claims_json =
            serde_json::to_value(id_token_claims).map_err(|e| OidcError::Claims {
                message: format!("Failed to convert id token claims to JSON: {e}"),
            })?;

        let transformed_claims = if let Some(user_info_claims) = user_info_claims {
            let user_info_claims_json =
                serde_json::to_value(user_info_claims).map_err(|e| OidcError::Claims {
                    message: format!("Failed to convert user info claims to JSON: {e}"),
                })?;
            if let (
                serde_json::Value::Object(mut id_token_claims_obj),
                serde_json::Value::Object(user_info_claims_obj),
            ) = (id_token_claims_json, user_info_claims_json)
            {
                id_token_claims_obj.extend(user_info_claims_obj);
                id_token_claims_obj
            } else {
                return Err(OidcError::Claims {
                    message: "Failed to convert mixed claims to JSON".to_string(),
                });
            }
        } else {
            if let serde_json::Value::Object(id_token_claims_obj) = id_token_claims_json {
                id_token_claims_obj
            } else {
                return Err(OidcError::Claims {
                    message: "Failed to convert id token claims to JSON".to_string(),
                });
            }
        };
        Ok(ClaimsCheckResult {
            display_name: name,
            picture,
            claims: transformed_claims.into_iter().collect(),
        })
    }
}
