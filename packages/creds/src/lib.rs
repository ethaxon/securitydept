pub mod basic;
pub mod config;
pub mod error;
#[cfg(feature = "jwe")]
pub mod jwe;
#[cfg(feature = "jwk")]
pub mod jwk;
#[cfg(feature = "jwt")]
pub mod jwt;
#[cfg(feature = "rfc9068")]
pub mod rfc9068;
pub mod static_token;
pub mod token;
pub mod validator;
#[cfg(feature = "zone")]
pub mod zone;

pub use basic::{
    Argon2BasicAuthCred, BasicAuthCred, hash_password_argon2, parse_basic_auth_header_opt,
    verify_password_argon2,
};
pub use config::{BasicAuthCredsConfig, StaticTokenAuthCredsConfig};
pub use error::{CredsError, CredsResult};
#[cfg(feature = "jwe")]
pub use jwe::{
    JweDecryptedData, JweTokenData, decrypt_token_jwe, decrypt_token_jwe_with_jwks,
    verify_token_jwe_payload_with_jwks,
};
#[cfg(all(feature = "jwk", feature = "jwe"))]
pub use jwk::{JweJwkTrait, JweJwksTrait};
#[cfg(all(feature = "jwk", feature = "jwt"))]
pub use jwk::{JwtJwkTrait, JwtJwksTrait};
#[cfg(feature = "jwt")]
pub use jwt::{
    EmptyJwtClaims, ExtraJwtClaims, JwtClaimsTrait, JwtDecodingKey, JwtHeader, JwtTokenData,
    JwtValidation, verify_token_jwt, verify_token_jwt_with_jwks,
};
#[cfg(feature = "rfc9068")]
pub use rfc9068::{TokenData, TokenFormat, verify_token_rfc9068_with_jwks};
pub use static_token::{
    Sha256TokenAuthCred, StaticTokenAuthCred, generate_static_token, hash_token_sha256,
    verify_token_sha256,
};
pub use token::{TokenAuthCred, parse_bearer_auth_header, parse_bearer_auth_header_opt};
pub use validator::{
    BasicAuthCredsValidator, MapBasicAuthCredsValidator, MapStaticTokenAuthCredsValidator,
    StaticTokenAuthCredsValidator,
};
#[cfg(feature = "zone")]
pub use zone::BasicAuthZoneConfig;
