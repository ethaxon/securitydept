use std::collections::HashMap;

pub use jsonwebtoken::{
    DecodingKey as JwtDecodingKey, Header as JwtHeader, TokenData as JwtTokenData,
    Validation as JwtValidation,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use snafu::ResultExt;

use crate::{
    CredsResult, JwtJwkTrait, JwtJwksTrait,
    error::{CredsError, JSONWebTokenSnafu},
};

pub trait JwtClaimsTrait: DeserializeOwned + Clone {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmptyJwtClaims {}

impl JwtClaimsTrait for EmptyJwtClaims {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraJwtClaims {
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl JwtClaimsTrait for ExtraJwtClaims {}

pub fn verify_token_jwt<CLAIMS, F>(
    token: &str,
    key: &JwtDecodingKey,
    validation_fn: F,
) -> CredsResult<JwtTokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
    F: FnOnce(JwtValidation) -> CredsResult<JwtValidation>,
{
    let header = jsonwebtoken::decode_header(token).context(JSONWebTokenSnafu)?;

    let validation = validation_fn(JwtValidation::new(header.alg))?;

    let token_data =
        jsonwebtoken::decode::<CLAIMS>(token, key, &validation).context(JSONWebTokenSnafu)?;
    Ok(token_data)
}

pub fn verify_token_jwt_with_jwks<CLAIMS, JWK, JWKS, F>(
    token: &str,
    jwks: &JWKS,
    validation_fn: F,
) -> CredsResult<JwtTokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
    JWK: JwtJwkTrait,
    JWKS: JwtJwksTrait<JWK>,
    F: FnOnce(JwtValidation) -> CredsResult<JwtValidation>,
{
    let header = jsonwebtoken::decode_header(token).context(JSONWebTokenSnafu)?;

    let jwk = find_jwk_for_jwt(header.kid.as_deref(), jwks)?;

    let jwk = jwk.to_jwt_jwk()?;

    let key = JwtDecodingKey::from_jwk(&jwk).context(JSONWebTokenSnafu)?;

    let validation = validation_fn(JwtValidation::new(header.alg))?;

    let token_data =
        jsonwebtoken::decode::<CLAIMS>(token, &key, &validation).context(JSONWebTokenSnafu)?;

    Ok(token_data)
}

fn find_jwk_for_jwt<'a, JWK, JWKS>(kid: Option<&str>, jwks: &'a JWKS) -> CredsResult<&'a JWK>
where
    JWK: JwtJwkTrait,
    JWKS: JwtJwksTrait<JWK>,
{
    match kid {
        Some(kid) => jwks
            .find(kid)
            .ok_or_else(|| CredsError::InvalidCredentialsFormat {
                message: format!("No matching JWK found for kid: {kid}"),
            }),
        None => {
            if jwks.keys().len() == 1 {
                Ok(&jwks.keys()[0])
            } else {
                Err(CredsError::InvalidCredentialsFormat {
                    message: "JWT has no kid and JWKS contains multiple keys".to_string(),
                })
            }
        }
    }
}
