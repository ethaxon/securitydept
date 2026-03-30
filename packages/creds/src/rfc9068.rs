use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use crate::{
    Audience, CredsResult, JwtClaimsTrait, JwtJwkTrait, JwtJwksTrait, JwtTokenData, JwtValidation,
    Scope, verify_token_jwt_with_jwks,
};

/// [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) claims.
/// This is the claims that are required by the RFC.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenJwtClaims {
    #[serde(rename = "sub")]
    pub subject: String,
    #[serde(rename = "iss")]
    pub issuer: String,
    #[serde(rename = "aud")]
    pub audience: Audience,
    #[serde(rename = "exp")]
    pub expiration_time: u64,
    #[serde(rename = "nbf")]
    pub not_before: Option<u64>,
    #[serde(rename = "iat")]
    pub issued_at: u64,
    #[serde(rename = "jti")]
    pub jwt_id: String,
    // client_id is required by RFC 9068, but it is not required by all implementations, such as
    // authentik
    #[serde(rename = "client_id")]
    pub client_id: Option<String>,
    #[serde(rename = "scope")]
    pub scope: Option<Scope>,
    #[serde(rename = "auth_time")]
    pub auth_time: Option<u64>,
    #[serde(rename = "acr")]
    pub acr: Option<String>,
    #[serde(rename = "amr")]
    pub amr: Option<Vec<String>>,
    #[serde(rename = "nounce")]
    pub nounce: Option<String>,
    #[serde(rename = "azp")]
    pub azp: Option<String>,
    #[serde(flatten, skip_serializing_if = "HashMap::is_empty")]
    pub additional: HashMap<String, serde_json::Value>,
}

impl JwtClaimsTrait for TokenJwtClaims {
    fn get_subject(&self) -> Option<&str> {
        Some(&self.subject)
    }
    fn get_issuer(&self) -> Option<&str> {
        Some(&self.issuer)
    }
    fn get_audience(&self) -> Option<&Audience> {
        Some(&self.audience)
    }
    fn get_expiration_time(&self) -> Option<u64> {
        Some(self.expiration_time)
    }
    fn get_not_before(&self) -> Option<u64> {
        self.not_before
    }
    fn get_additional(&self) -> Option<&HashMap<String, serde_json::Value>> {
        Some(&self.additional)
    }
}

#[derive(Deserialize)]
struct JWTHeaderMinimalValidation {
    #[allow(unused)]
    alg: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenFormat {
    JWT,
    JWE,
    Opaque,
}

impl TokenFormat {
    pub fn from_token(token: &str) -> Self {
        // JWT tokens start with "eyJ" => {
        if !token.starts_with("eyJ") {
            return TokenFormat::Opaque;
        }
        let mut parts = token.split('.');
        if let Some(token_header) = parts.next()
            && let Ok(decoded) = URL_SAFE_NO_PAD.decode(token_header)
            && serde_json::from_slice::<JWTHeaderMinimalValidation>(&decoded).is_ok()
        {
            return match parts.count() {
                2 => TokenFormat::JWT,
                4 => TokenFormat::JWE,
                _ => TokenFormat::Opaque,
            };
        }
        TokenFormat::Opaque
    }
}

pub enum TokenData<CLAIMS: JwtClaimsTrait> {
    JWT(Box<JwtTokenData<CLAIMS>>),
    #[cfg(feature = "jwe")]
    JWE(Box<crate::JweTokenData<CLAIMS>>),
    Opaque,
}

#[cfg(feature = "jwe")]
pub fn verify_token_rfc9068_with_jwks<CLAIMS, JWTJWK, JWTJWKS, JWEJWK, JWEJWKS, VF>(
    token: &str,
    jwt_jwks: &JWTJWKS,
    jwe_jwks: &JWEJWKS,
    validation_fn: VF,
) -> CredsResult<TokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
    JWTJWK: JwtJwkTrait,
    JWTJWKS: JwtJwksTrait<JWTJWK>,
    JWEJWK: crate::JweJwkTrait,
    JWEJWKS: crate::JweJwksTrait<JWEJWK>,
    VF: FnOnce(JwtValidation) -> CredsResult<JwtValidation>,
{
    let token_format = TokenFormat::from_token(token);
    match token_format {
        TokenFormat::JWT => {
            let data = verify_token_jwt_with_jwks(token, jwt_jwks, validation_fn)?;
            Ok(TokenData::JWT(Box::new(data)))
        }
        TokenFormat::JWE => {
            let jwe_decrypted_data = crate::decrypt_token_jwe_with_jwks(token, jwe_jwks)?;
            let data = crate::verify_token_jwe_payload_with_jwks::<CLAIMS, JWTJWK, JWTJWKS, VF>(
                jwe_decrypted_data,
                jwt_jwks,
                validation_fn,
            )?;
            Ok(TokenData::JWE(Box::new(data)))
        }
        TokenFormat::Opaque => Ok(TokenData::Opaque),
    }
}

pub fn verify_token_rfc9068_with_jwks_without_jwe<CLAIMS, JWTJWK, JWTJWKS, VF>(
    token: &str,
    jwt_jwks: &JWTJWKS,
    validation_fn: VF,
) -> CredsResult<TokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
    JWTJWK: JwtJwkTrait,
    JWTJWKS: JwtJwksTrait<JWTJWK>,
    VF: FnOnce(JwtValidation) -> CredsResult<JwtValidation>,
{
    let token_format = TokenFormat::from_token(token);
    match token_format {
        TokenFormat::JWT => {
            let data = verify_token_jwt_with_jwks(token, jwt_jwks, validation_fn)?;
            Ok(TokenData::JWT(Box::new(data)))
        }
        TokenFormat::JWE => Err(crate::CredsError::InvalidCredentialsFormat {
            message: "JWE token format is not supported when JWE feature is disabled".to_string(),
        }),
        TokenFormat::Opaque => Ok(TokenData::Opaque),
    }
}
