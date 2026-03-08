use std::{collections::HashMap, ops::Deref};

use jsonwebtoken::TokenData as JwtTokenDataOrigin;
pub use jsonwebtoken::{
    DecodingKey as JwtDecodingKey, Header as JwtHeader, Validation as JwtValidation,
};
use securitydept_utils::ser::SpaceSeparated;
use serde::{Deserialize, Serialize, Serializer, de::DeserializeOwned};
use serde_with::{OneOrMany, formats::PreferOne, serde_as};
use snafu::ResultExt;

use crate::{
    CredsResult, JwtJwkTrait, JwtJwksTrait,
    error::{CredsError, JSONWebTokenSnafu},
};

pub type JwtTokenData<T> = JwtTokenDataOrigin<T>;

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Audience(#[serde_as(as = "OneOrMany<_, PreferOne>")] Vec<String>);

impl Deref for Audience {
    type Target = Vec<String>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[serde_as]
#[derive(Debug, Deserialize, Clone)]
pub struct Scope(#[serde_as(as = "SpaceSeparated<String>")] Vec<String>);

impl Serialize for Scope {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0.join(" "))
    }
}

impl Deref for Scope {
    type Target = Vec<String>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

pub trait JwtClaimsTrait: DeserializeOwned + Clone {
    fn get_subject(&self) -> Option<&str>;
    fn get_issuer(&self) -> Option<&str>;
    fn get_audience(&self) -> Option<&Audience>;
    fn get_expiration_time(&self) -> Option<u64>;
    fn get_not_before(&self) -> Option<u64>;
    fn get_additional(&self) -> Option<&HashMap<String, serde_json::Value>>;
}

/// [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) claims.
/// This is the core claims that are required by the RFC.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CoreJwtClaims {
    #[serde(rename = "sub")]
    pub subject: Option<String>,
    #[serde(rename = "iss")]
    pub issuer: Option<String>,
    #[serde(rename = "aud")]
    pub audience: Option<Audience>,
    #[serde(rename = "exp")]
    pub expiration_time: Option<u64>,
    #[serde(rename = "nbf")]
    pub not_before: Option<u64>,
    #[serde(flatten)]
    pub additional: HashMap<String, serde_json::Value>,
}

impl JwtClaimsTrait for CoreJwtClaims {
    fn get_subject(&self) -> Option<&str> {
        self.subject.as_deref()
    }
    fn get_issuer(&self) -> Option<&str> {
        self.issuer.as_deref()
    }
    fn get_audience(&self) -> Option<&Audience> {
        self.audience.as_ref()
    }
    fn get_expiration_time(&self) -> Option<u64> {
        self.expiration_time
    }
    fn get_not_before(&self) -> Option<u64> {
        self.not_before
    }
    fn get_additional(&self) -> Option<&HashMap<String, serde_json::Value>> {
        Some(&self.additional)
    }
}

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
