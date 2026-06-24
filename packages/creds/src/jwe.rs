use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use no_way_jose_aes_cbc_hs::{A128CbcHs256, A192CbcHs384, A256CbcHs512};
use no_way_jose_aes_gcm::{A128Gcm, A192Gcm, A256Gcm};
use no_way_jose_aes_gcm_kw::{A128GcmKw, A192GcmKw, A256GcmKw};
use no_way_jose_aes_kw::{A128Kw, A192Kw, A256Kw};
use no_way_jose_core::{
    EncryptionKey, UntypedCompactJwe,
    dir::{self, Dir},
    json::RawJson,
    jwe_algorithm::{ContentCipher, KeyManager},
    jwk::{FromJwk, Jwk, JwkParams},
    validation::NoValidation,
};
use no_way_jose_ecdh_es::{EcdhEs, EcdhEsA128Kw, EcdhEsA192Kw, EcdhEsA256Kw};
use no_way_jose_pbes2::{Pbes2Hs256A128Kw, Pbes2Hs384A192Kw, Pbes2Hs512A256Kw};
use no_way_jose_rsa::{RsaOaep, RsaOaep256};
use serde::Deserialize;

use crate::{
    CredsResult, JweJwkTrait, JweJwksTrait, JwtClaimsTrait, JwtDecodingKey, JwtHeader, JwtJwkTrait,
    JwtJwksTrait, JwtValidation, error::CredsError, verify_token_jwt, verify_token_jwt_with_jwks,
};

pub struct JweDecryptedData {
    pub payload: Vec<u8>,
    pub header: JweHeader,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct JweHeader {
    alg: String,
    enc: String,
    #[serde(default)]
    kid: Option<String>,
    #[serde(default)]
    typ: Option<String>,
    #[serde(default)]
    cty: Option<String>,
    #[serde(default)]
    crit: Option<Vec<String>>,
    #[serde(flatten)]
    additional: serde_json::Map<String, serde_json::Value>,
}

impl JweHeader {
    pub fn algorithm(&self) -> &str {
        &self.alg
    }

    pub fn content_encryption(&self) -> &str {
        &self.enc
    }

    pub fn key_id(&self) -> Option<&str> {
        self.kid.as_deref()
    }

    pub fn token_type(&self) -> Option<&str> {
        self.typ.as_deref()
    }

    pub fn content_type(&self) -> Option<&str> {
        self.cty.as_deref()
    }

    pub fn critical(&self) -> Option<&[String]> {
        self.crit.as_deref()
    }

    pub fn additional(&self) -> &serde_json::Map<String, serde_json::Value> {
        &self.additional
    }
}

#[derive(Debug)]
pub struct JweTokenData<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    jwe_header: JweHeader,
    jwt_header: JwtHeader,
    claims: CLAIMS,
}

impl<CLAIMS> JweTokenData<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    pub fn jwe_header(&self) -> &JweHeader {
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

fn parse_jwe_compact(token: &str) -> CredsResult<(UntypedCompactJwe<RawJson>, JweHeader)> {
    let parsed = token.parse().map_err(jwe_error)?;
    let header_part = token
        .split_once('.')
        .map(|(header, _)| header)
        .ok_or_else(|| CredsError::InvalidCredentialsFormat {
            message: "JWE token has no header part".to_string(),
        })?;
    let decoded =
        URL_SAFE_NO_PAD
            .decode(header_part)
            .map_err(|e| CredsError::InvalidCredentialsFormat {
                message: format!("Failed to decode JWE header: {e}"),
            })?;
    let header =
        serde_json::from_slice(&decoded).map_err(|e| CredsError::InvalidCredentialsFormat {
            message: format!("Failed to parse JWE header JSON: {e}"),
        })?;
    Ok((parsed, header))
}

fn jwe_error(error: impl std::fmt::Display) -> CredsError {
    CredsError::Jwe {
        message: error.to_string(),
    }
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

macro_rules! decrypt_with_jwk_key {
    ($token:expr, $header:expr, $jwk:expr, $algorithm:ty) => {{
        let key = EncryptionKey::<$algorithm>::from_jwk($jwk).map_err(jwe_error)?;
        decrypt_with_content::<$algorithm>($token, $header, &key)
    }};
}

fn decrypt_token_jwe_parsed(
    token: UntypedCompactJwe<RawJson>,
    header: JweHeader,
    jwk: &Jwk,
) -> CredsResult<JweDecryptedData> {
    match header.algorithm() {
        "RSA1_5" => Err(CredsError::InvalidCredentialsFormat {
            message: "JWE algorithm RSA1_5 is deprecated and not supported".to_string(),
        }),
        "RSA-OAEP" => decrypt_with_jwk_key!(token, header, jwk, RsaOaep),
        "RSA-OAEP-256" => decrypt_with_jwk_key!(token, header, jwk, RsaOaep256),
        "RSA-OAEP-384" | "RSA-OAEP-512" => Err(CredsError::InvalidCredentialsFormat {
            message: format!(
                "JWE algorithm {} is not supported by no-way-jose",
                header.algorithm()
            ),
        }),
        "ECDH-ES" => decrypt_with_jwk_key!(token, header, jwk, EcdhEs),
        "ECDH-ES+A128KW" => decrypt_with_jwk_key!(token, header, jwk, EcdhEsA128Kw),
        "ECDH-ES+A192KW" => decrypt_with_jwk_key!(token, header, jwk, EcdhEsA192Kw),
        "ECDH-ES+A256KW" => decrypt_with_jwk_key!(token, header, jwk, EcdhEsA256Kw),
        "A128KW" => decrypt_with_jwk_key!(token, header, jwk, A128Kw),
        "A192KW" => decrypt_with_jwk_key!(token, header, jwk, A192Kw),
        "A256KW" => decrypt_with_jwk_key!(token, header, jwk, A256Kw),
        "A128GCMKW" => decrypt_with_jwk_key!(token, header, jwk, A128GcmKw),
        "A192GCMKW" => decrypt_with_jwk_key!(token, header, jwk, A192GcmKw),
        "A256GCMKW" => decrypt_with_jwk_key!(token, header, jwk, A256GcmKw),
        "dir" => {
            let key = dir::key(oct_key_bytes(jwk, "dir")?);
            decrypt_with_content::<Dir>(token, header, &key)
        }
        "PBES2-HS256+A128KW" => {
            let key = no_way_jose_pbes2::pbes2_hs256_a128kw::key(oct_key_bytes(
                jwk,
                "PBES2-HS256+A128KW",
            )?);
            decrypt_with_content::<Pbes2Hs256A128Kw>(token, header, &key)
        }
        "PBES2-HS384+A192KW" => {
            let key = no_way_jose_pbes2::pbes2_hs384_a192kw::key(oct_key_bytes(
                jwk,
                "PBES2-HS384+A192KW",
            )?);
            decrypt_with_content::<Pbes2Hs384A192Kw>(token, header, &key)
        }
        "PBES2-HS512+A256KW" => {
            let key = no_way_jose_pbes2::pbes2_hs512_a256kw::key(oct_key_bytes(
                jwk,
                "PBES2-HS512+A256KW",
            )?);
            decrypt_with_content::<Pbes2Hs512A256Kw>(token, header, &key)
        }
        algorithm => Err(CredsError::InvalidCredentialsFormat {
            message: format!("Unsupported JWE algorithm: {algorithm}"),
        }),
    }
}

fn oct_key_bytes(jwk: &Jwk, expected_algorithm: &str) -> CredsResult<Vec<u8>> {
    if let Some(algorithm) = jwk.alg.as_deref()
        && algorithm != expected_algorithm
    {
        return Err(CredsError::InvalidCredentialsFormat {
            message: format!(
                "JWK algorithm {algorithm} does not match JWE algorithm {expected_algorithm}"
            ),
        });
    }

    match &jwk.key {
        JwkParams::Oct(parameters) => Ok(parameters.k.clone()),
        _ => Err(CredsError::InvalidCredentialsFormat {
            message: format!("JWE algorithm {expected_algorithm} requires an oct JWK"),
        }),
    }
}

fn decrypt_with_content<KM>(
    token: UntypedCompactJwe<RawJson>,
    header: JweHeader,
    key: &EncryptionKey<KM>,
) -> CredsResult<JweDecryptedData>
where
    KM: KeyManager,
{
    let content_encryption = header.content_encryption().to_string();
    match content_encryption.as_str() {
        "A128GCM" => decrypt_typed::<KM, A128Gcm>(token, header, key),
        "A192GCM" => decrypt_typed::<KM, A192Gcm>(token, header, key),
        "A256GCM" => decrypt_typed::<KM, A256Gcm>(token, header, key),
        "A128CBC-HS256" => decrypt_typed::<KM, A128CbcHs256>(token, header, key),
        "A192CBC-HS384" => decrypt_typed::<KM, A192CbcHs384>(token, header, key),
        "A256CBC-HS512" => decrypt_typed::<KM, A256CbcHs512>(token, header, key),
        content_encryption => Err(CredsError::InvalidCredentialsFormat {
            message: format!("Unsupported JWE content encryption: {content_encryption}"),
        }),
    }
}

fn decrypt_typed<KM, CE>(
    token: UntypedCompactJwe<RawJson>,
    header: JweHeader,
    key: &EncryptionKey<KM>,
) -> CredsResult<JweDecryptedData>
where
    KM: KeyManager,
    CE: ContentCipher,
{
    let token = token.into_typed::<KM, CE>().map_err(jwe_error)?;
    let decrypted = token
        .decrypt(key, &NoValidation::dangerous_no_validation())
        .map_err(jwe_error)?;
    Ok(JweDecryptedData {
        payload: decrypted.claims.0.into_bytes(),
        header,
    })
}

pub fn decrypt_token_jwe(token: &str, jwk: &Jwk) -> CredsResult<JweDecryptedData> {
    let (token, header) = parse_jwe_compact(token)?;
    decrypt_token_jwe_parsed(token, header, jwk)
}

pub fn decrypt_token_jwe_with_jwks<JWK, JWKS>(
    token: &str,
    jwks: &JWKS,
) -> CredsResult<JweDecryptedData>
where
    JWK: JweJwkTrait,
    JWKS: JweJwksTrait<JWK>,
{
    let (token, header) = parse_jwe_compact(token)?;
    let jwk = find_jwk_for_jwe(header.key_id(), jwks)?;
    let jwk = jwk.to_jwe_jwk()?;
    decrypt_token_jwe_parsed(token, header, &jwk)
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

#[cfg(test)]
mod tests {
    use no_way_jose_aes_cbc_hs::A128CbcHs256;
    use no_way_jose_aes_gcm::A256Gcm;
    use no_way_jose_aes_gcm_kw::{A128GcmKw, a128gcmkw};
    use no_way_jose_aes_kw::{A128Kw, a128kw};
    use no_way_jose_core::{
        dir,
        json::RawJson,
        jwk::{Jwk, JwkParams, KeyUse, OctParams},
        purpose::Encrypted,
        tokens::UnsealedToken,
    };

    use super::{decrypt_token_jwe, decrypt_token_jwe_with_jwks};
    use crate::LocalJweDecryptionKeySet;

    const NESTED_JWT: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";

    fn oct_jwk(key: &[u8], algorithm: &str, key_id: Option<&str>) -> Jwk {
        Jwk {
            kid: key_id.map(str::to_string),
            alg: Some(algorithm.to_string()),
            use_: Some(KeyUse::Enc),
            key_ops: None,
            key: JwkParams::Oct(OctParams { k: key.to_vec() }),
        }
    }

    #[test]
    fn decrypts_direct_a256gcm_nested_jwt() {
        let key_bytes = vec![7; 32];
        let token = UnsealedToken::<Encrypted<dir::Dir, A256Gcm>, RawJson>::builder(RawJson(
            NESTED_JWT.to_string(),
        ))
        .kid("enc-key-1")
        .cty("JWT")
        .build()
        .encrypt(&dir::key(key_bytes.clone()))
        .expect("JWE should encrypt")
        .to_string();

        let decrypted = decrypt_token_jwe(&token, &oct_jwk(&key_bytes, "dir", Some("enc-key-1")))
            .expect("JWE should decrypt");

        assert_eq!(decrypted.payload, NESTED_JWT.as_bytes());
        assert_eq!(decrypted.header.algorithm(), "dir");
        assert_eq!(decrypted.header.content_encryption(), "A256GCM");
        assert_eq!(decrypted.header.key_id(), Some("enc-key-1"));
        assert_eq!(decrypted.header.content_type(), Some("JWT"));
    }

    #[test]
    fn selects_decryption_key_by_kid() {
        let key_bytes = vec![9; 32];
        let token = UnsealedToken::<Encrypted<dir::Dir, A256Gcm>, RawJson>::builder(RawJson(
            NESTED_JWT.to_string(),
        ))
        .kid("selected")
        .build()
        .encrypt(&dir::key(key_bytes.clone()))
        .expect("JWE should encrypt")
        .to_string();
        let keys = LocalJweDecryptionKeySet::new(vec![
            oct_jwk(&[3; 32], "dir", Some("other")),
            oct_jwk(&key_bytes, "dir", Some("selected")),
        ]);

        let decrypted =
            decrypt_token_jwe_with_jwks::<Jwk, _>(&token, &keys).expect("JWE should decrypt");

        assert_eq!(decrypted.payload, NESTED_JWT.as_bytes());
    }

    #[test]
    fn decrypts_aes_key_wrap_with_cbc_hmac_content() {
        let key_bytes = vec![11; 16];
        let token = UnsealedToken::<Encrypted<A128Kw, A128CbcHs256>, RawJson>::new(RawJson(
            NESTED_JWT.to_string(),
        ))
        .encrypt(&a128kw::key(key_bytes.clone()).expect("AES-KW key should be valid"))
        .expect("JWE should encrypt")
        .to_string();

        let decrypted = decrypt_token_jwe(&token, &oct_jwk(&key_bytes, "A128KW", None))
            .expect("JWE should decrypt");

        assert_eq!(decrypted.payload, NESTED_JWT.as_bytes());
        assert_eq!(decrypted.header.content_encryption(), "A128CBC-HS256");
    }

    #[test]
    fn decrypts_aes_gcm_key_wrap_with_protected_parameters() {
        let key_bytes = vec![13; 16];
        let token = UnsealedToken::<Encrypted<A128GcmKw, A256Gcm>, RawJson>::new(RawJson(
            NESTED_JWT.to_string(),
        ))
        .encrypt(&a128gcmkw::key(key_bytes.clone()).expect("AES-GCM-KW key should be valid"))
        .expect("JWE should encrypt")
        .to_string();

        let decrypted = decrypt_token_jwe(&token, &oct_jwk(&key_bytes, "A128GCMKW", None))
            .expect("JWE should decrypt");

        assert_eq!(decrypted.payload, NESTED_JWT.as_bytes());
        assert!(decrypted.header.additional().contains_key("iv"));
        assert!(decrypted.header.additional().contains_key("tag"));
    }
}
