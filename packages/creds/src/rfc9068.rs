use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;

use crate::{
    CredsResult, JwtClaimsTrait, JwtJwkTrait, JwtJwksTrait, JwtTokenData, JwtValidation,
    verify_token_jwt_with_jwks,
};

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

#[cfg(not(feature = "jwe"))]
pub fn verify_token_rfc9068_with_jwks<CLAIMS, JWTJWK, JWTJWKS, VF>(
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
