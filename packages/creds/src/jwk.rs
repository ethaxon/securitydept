use std::borrow::Cow;

#[cfg(all(feature = "oidc", feature = "jwt"))]
use openidconnect::JsonWebKey;

use crate::{CredsError, CredsResult};

#[cfg(feature = "jwt")]
pub trait JwtJwkTrait {
    fn to_jwt_jwk<'a>(&'a self) -> CredsResult<Cow<'a, jsonwebtoken::jwk::Jwk>>;
}

#[cfg(feature = "jwe")]
pub trait JweJwkTrait {
    fn to_jwe_jwk<'a>(&'a self) -> CredsResult<Cow<'a, josekit::jwk::Jwk>>;
}

#[cfg(feature = "jwt")]
pub trait JwtJwksTrait<JWK: JwtJwkTrait> {
    fn find(&self, kid: &str) -> Option<&JWK>;

    fn keys(&self) -> &[JWK];
}

#[cfg(feature = "jwt")]
impl JwtJwkTrait for jsonwebtoken::jwk::Jwk {
    fn to_jwt_jwk<'a>(&'a self) -> CredsResult<Cow<'a, jsonwebtoken::jwk::Jwk>> {
        Ok(Cow::Borrowed(self))
    }
}

#[cfg(feature = "jwt")]
impl JwtJwksTrait<jsonwebtoken::jwk::Jwk> for jsonwebtoken::jwk::JwkSet {
    fn find(&self, kid: &str) -> Option<&jsonwebtoken::jwk::Jwk> {
        <jsonwebtoken::jwk::JwkSet>::find(self, kid)
    }

    fn keys(&self) -> &[jsonwebtoken::jwk::Jwk] {
        &self.keys
    }
}

#[cfg(feature = "jwe")]
pub trait JweJwksTrait<JWK: JweJwkTrait> {
    fn find(&self, kid: &str) -> Option<&JWK>;

    fn keys(&self) -> &[JWK];
}

#[cfg(feature = "jwe")]
impl JweJwkTrait for josekit::jwk::Jwk {
    fn to_jwe_jwk<'a>(&'a self) -> CredsResult<Cow<'a, josekit::jwk::Jwk>> {
        Ok(Cow::Borrowed(self))
    }
}

#[cfg(feature = "jwe")]
#[derive(Debug, Clone)]
pub struct LocalJweDecryptionKeySet {
    keys: Vec<josekit::jwk::Jwk>,
}

#[cfg(feature = "jwe")]
impl LocalJweDecryptionKeySet {
    pub fn new(keys: Vec<josekit::jwk::Jwk>) -> Self {
        Self { keys }
    }

    pub fn keys(&self) -> &[josekit::jwk::Jwk] {
        &self.keys
    }
}

#[cfg(feature = "jwe")]
impl JweJwksTrait<josekit::jwk::Jwk> for LocalJweDecryptionKeySet {
    fn find(&self, kid: &str) -> Option<&josekit::jwk::Jwk> {
        self.keys
            .iter()
            .find(|jwk| jwk.key_id().is_some_and(|value| value == kid))
    }

    fn keys(&self) -> &[josekit::jwk::Jwk] {
        &self.keys
    }
}

#[cfg(all(feature = "oidc", feature = "jwt"))]
impl JwtJwkTrait for openidconnect::core::CoreJsonWebKey {
    fn to_jwt_jwk<'a>(&'a self) -> CredsResult<Cow<'a, jsonwebtoken::jwk::Jwk>> {
        let value =
            serde_json::to_value(self).map_err(|e| CredsError::InvalidCredentialsFormat {
                message: format!(
                    "Failed to convert OIDC JWK to JWT JWK when converting to JSON: {e}"
                ),
            })?;
        let jwk =
            serde_json::from_value(value).map_err(|e| CredsError::InvalidCredentialsFormat {
                message: format!("Failed to convert OIDC JWK to JWT JWK: {e}"),
            })?;
        Ok(Cow::Owned(jwk))
    }
}

#[cfg(all(feature = "oidc", feature = "jwt"))]
impl JwtJwksTrait<openidconnect::core::CoreJsonWebKey> for openidconnect::core::CoreJsonWebKeySet {
    fn find(&self, kid: &str) -> Option<&openidconnect::core::CoreJsonWebKey> {
        <openidconnect::JsonWebKeySet<openidconnect::core::CoreJsonWebKey>>::keys(self)
            .iter()
            .find(|jwk| jwk.key_id().is_some_and(|value| value.to_string() == kid))
    }

    fn keys(&self) -> &[openidconnect::core::CoreJsonWebKey] {
        <openidconnect::JsonWebKeySet<openidconnect::core::CoreJsonWebKey>>::keys(self).as_slice()
    }
}
