use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use josekit::jwe::{
    self, JweDecrypter, JweHeader,
    alg::{
        aesgcmkw::AesgcmkwJweAlgorithm, aeskw::AeskwJweAlgorithm, direct::DirectJweAlgorithm,
        ecdh_es::EcdhEsJweAlgorithm, pbes2_hmac_aeskw::Pbes2HmacAeskwJweAlgorithm,
        rsaes::RsaesJweAlgorithm,
    },
};
use serde::Deserialize;
use snafu::ResultExt;

use crate::{
    CredsResult, JweJwkTrait, JweJwksTrait, JwtClaimsTrait, JwtDecodingKey, JwtHeader, JwtJwkTrait,
    JwtJwksTrait, JwtValidation,
    error::{CredsError, JoseKitSnafu},
    verify_token_jwt, verify_token_jwt_with_jwks,
};

pub struct JweDecryptedData {
    pub payload: Vec<u8>,
    pub header: JweHeader,
}

#[derive(Deserialize)]
struct JweCompactHeader {
    alg: String,
    kid: Option<String>,
}

#[derive(Debug)]
pub struct JweTokenData<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    jwe_header: jwe::JweHeader,
    jwt_header: JwtHeader,
    claims: CLAIMS,
}

impl<CLAIMS> JweTokenData<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    pub fn jwe_header(&self) -> &jwe::JweHeader {
        &self.jwe_header
    }

    pub fn jwt_header(&self) -> &JwtHeader {
        &self.jwt_header
    }

    pub fn claims(&self) -> &CLAIMS {
        &self.claims
    }
}

impl<CLAIMS> Clone for JweTokenData<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    fn clone(&self) -> Self {
        Self {
            jwe_header: self.jwe_header.clone(),
            jwt_header: self.jwt_header.clone(),
            claims: self.claims.clone(),
        }
    }
}

fn parse_jwe_compact_header(token: &str) -> CredsResult<JweCompactHeader> {
    let header_part =
        token
            .split('.')
            .next()
            .ok_or_else(|| CredsError::InvalidCredentialsFormat {
                message: "JWE token has no header part".to_string(),
            })?;
    let decoded =
        URL_SAFE_NO_PAD
            .decode(header_part)
            .map_err(|e| CredsError::InvalidCredentialsFormat {
                message: format!("Failed to decode JWE header: {e}"),
            })?;
    let jwe_header: JweCompactHeader =
        serde_json::from_slice(&decoded).map_err(|e| CredsError::InvalidCredentialsFormat {
            message: format!("Failed to parse JWE header JSON: {e}"),
        })?;
    Ok(jwe_header)
}

fn build_decrypter_from_jwk(
    alg: &str,
    jwk: &josekit::jwk::Jwk,
) -> CredsResult<Box<dyn JweDecrypter>> {
    let decrypter: Box<dyn JweDecrypter> = match alg {
        "RSA1_5" => {
            return Err(CredsError::InvalidCredentialsFormat {
                message: "JWE algorithm RSA1_5 is deprecated and not supported".to_string(),
            });
        }
        "RSA-OAEP" => Box::new(
            RsaesJweAlgorithm::RsaOaep
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "RSA-OAEP-256" => Box::new(
            RsaesJweAlgorithm::RsaOaep256
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "RSA-OAEP-384" => Box::new(
            RsaesJweAlgorithm::RsaOaep384
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "RSA-OAEP-512" => Box::new(
            RsaesJweAlgorithm::RsaOaep512
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "ECDH-ES" => Box::new(
            EcdhEsJweAlgorithm::EcdhEs
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "ECDH-ES+A128KW" => Box::new(
            EcdhEsJweAlgorithm::EcdhEsA128kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "ECDH-ES+A192KW" => Box::new(
            EcdhEsJweAlgorithm::EcdhEsA192kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "ECDH-ES+A256KW" => Box::new(
            EcdhEsJweAlgorithm::EcdhEsA256kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "A128KW" => Box::new(
            AeskwJweAlgorithm::A128kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "A192KW" => Box::new(
            AeskwJweAlgorithm::A192kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "A256KW" => Box::new(
            AeskwJweAlgorithm::A256kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "A128GCMKW" => Box::new(
            AesgcmkwJweAlgorithm::A128gcmkw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "A192GCMKW" => Box::new(
            AesgcmkwJweAlgorithm::A192gcmkw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "A256GCMKW" => Box::new(
            AesgcmkwJweAlgorithm::A256gcmkw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "dir" => Box::new(
            DirectJweAlgorithm::Dir
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "PBES2-HS256+A128KW" => Box::new(
            Pbes2HmacAeskwJweAlgorithm::Pbes2Hs256A128kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "PBES2-HS384+A192KW" => Box::new(
            Pbes2HmacAeskwJweAlgorithm::Pbes2Hs384A192kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        "PBES2-HS512+A256KW" => Box::new(
            Pbes2HmacAeskwJweAlgorithm::Pbes2Hs512A256kw
                .decrypter_from_jwk(jwk)
                .context(JoseKitSnafu)?,
        ),
        _ => {
            return Err(CredsError::InvalidCredentialsFormat {
                message: format!("Unsupported JWE algorithm: {alg}"),
            });
        }
    };
    Ok(decrypter)
}

fn find_jwk_for_jwe<'a, JWK, JWKS>(kid: Option<&str>, jwks: &'a JWKS) -> CredsResult<&'a JWK>
where
    JWK: JweJwkTrait,
    JWKS: JweJwksTrait<JWK>,
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
                    message: "JWE has no kid and JwkSet contains multiple keys".to_string(),
                })
            }
        }
    }
}

pub fn decrypt_token_jwe(
    token: &str,
    decrypter: &dyn JweDecrypter,
) -> CredsResult<JweDecryptedData> {
    let (payload, header) = jwe::deserialize_compact(token, decrypter).context(JoseKitSnafu)?;
    Ok(JweDecryptedData { payload, header })
}

pub fn decrypt_token_jwe_with_jwks<JWK, JWKS>(
    token: &str,
    jwks: &JWKS,
) -> CredsResult<JweDecryptedData>
where
    JWK: JweJwkTrait,
    JWKS: JweJwksTrait<JWK>,
{
    let hdr = parse_jwe_compact_header(token)?;
    let jwk = find_jwk_for_jwe(hdr.kid.as_deref(), jwks)?;
    let jwk = jwk.to_jwe_jwk()?;
    let decrypter = build_decrypter_from_jwk(&hdr.alg, &jwk)?;
    decrypt_token_jwe(token, decrypter.as_ref())
}

pub fn verify_token_jwe_payload<CLAIMS, VF>(
    data: JweDecryptedData,
    key: &JwtDecodingKey,
    validation_fn: VF,
) -> CredsResult<JweTokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
    VF: FnOnce(JwtValidation) -> CredsResult<JwtValidation>,
{
    let jwt_str = parse_jwe_payload_jwt_str(data.payload)?;
    let jwt_data = verify_token_jwt(&jwt_str, key, validation_fn)?;
    Ok(JweTokenData {
        jwe_header: data.header,
        jwt_header: jwt_data.header,
        claims: jwt_data.claims,
    })
}

pub fn verify_token_jwe_payload_with_jwks<CLAIMS, JWTJWK, JWTJWKS, VF>(
    data: JweDecryptedData,
    jwt_jwks: &JWTJWKS,
    validation_fn: VF,
) -> CredsResult<JweTokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
    JWTJWK: JwtJwkTrait,
    JWTJWKS: JwtJwksTrait<JWTJWK>,
    VF: FnOnce(JwtValidation) -> CredsResult<JwtValidation>,
{
    let jwt_str = parse_jwe_payload_jwt_str(data.payload)?;
    let jwt_data = verify_token_jwt_with_jwks::<CLAIMS, JWTJWK, JWTJWKS, VF>(
        &jwt_str,
        jwt_jwks,
        validation_fn,
    )?;
    Ok(JweTokenData {
        jwe_header: data.header,
        jwt_header: jwt_data.header,
        claims: jwt_data.claims,
    })
}

fn parse_jwe_payload_jwt_str(payload: Vec<u8>) -> CredsResult<String> {
    let payload = String::from_utf8(payload).map_err(|e| CredsError::InvalidCredentialsFormat {
        message: format!("JWE payload is not valid UTF-8: {e}"),
    })?;
    if !payload.starts_with("eyJ") || payload.split('.').count() != 3 {
        return Err(CredsError::InvalidCredentialsFormat {
            message: "Invalid JWE payload format: only support nested JWT payload for security \
                      reasons"
                .to_string(),
        });
    }
    Ok(payload)
}
