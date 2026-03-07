use std::borrow::Cow;

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

#[cfg(feature = "jwe")]
pub trait JweJwksTrait<JWK: JweJwkTrait> {
    fn find(&self, kid: &str) -> Option<&JWK>;

    fn keys(&self) -> &[JWK];
}

#[cfg(feature = "jwt")]
impl JwtJwkTrait for jsonwebtoken::jwk::Jwk {
    fn to_jwt_jwk<'a>(&'a self) -> CredsResult<Cow<'a, jsonwebtoken::jwk::Jwk>> {
        Ok(Cow::Borrowed(self))
    }
}

#[cfg(feature = "jwe")]
impl JweJwkTrait for josekit::jwk::Jwk {
    fn to_jwe_jwk<'a>(&'a self) -> CredsResult<Cow<'a, josekit::jwk::Jwk>> {
        Ok(Cow::Borrowed(self))
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
