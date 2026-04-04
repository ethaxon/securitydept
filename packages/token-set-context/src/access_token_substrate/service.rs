use securitydept_creds::{CoreJwtClaims, parse_bearer_auth_header_opt};
use securitydept_oauth_resource_server::{
    OAuthResourceServerError, OAuthResourceServerVerifier, ResourceTokenPrincipal,
};
use securitydept_utils::{
    error::{ErrorPresentation, ToErrorPresentation},
    http::ToHttpStatus,
};
use snafu::Snafu;

/// Errors produced by [`AccessTokenSubstrateResourceService`].
#[derive(Debug, Snafu)]
pub enum AccessTokenSubstrateResourceServiceError {
    #[snafu(transparent)]
    OAuthResourceServer { source: OAuthResourceServerError },
}

impl ToHttpStatus for AccessTokenSubstrateResourceServiceError {
    fn to_http_status(&self) -> http::StatusCode {
        match self {
            Self::OAuthResourceServer { source } => source.to_http_status(),
        }
    }
}

impl ToErrorPresentation for AccessTokenSubstrateResourceServiceError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::OAuthResourceServer { source } => source.to_error_presentation(),
        }
    }
}

/// Cross-mode resource service for verifying bearer tokens.
///
/// Validates access tokens using the configured
/// [`OAuthResourceServerVerifier`] and returns a [`ResourceTokenPrincipal`].
#[derive(Clone, Copy)]
pub struct AccessTokenSubstrateResourceService<'a> {
    verifier: &'a OAuthResourceServerVerifier,
}

impl<'a> AccessTokenSubstrateResourceService<'a> {
    pub fn new(verifier: &'a OAuthResourceServerVerifier) -> Self {
        Self { verifier }
    }

    pub async fn authenticate_authorization_header(
        &self,
        authorization_header: Option<&str>,
    ) -> Result<Option<ResourceTokenPrincipal>, AccessTokenSubstrateResourceServiceError> {
        let Some(authorization_header) = authorization_header else {
            return Ok(None);
        };
        let Some(token) = parse_bearer_auth_header_opt(authorization_header) else {
            return Ok(None);
        };

        let verified = self
            .verifier
            .verify_token::<CoreJwtClaims>(&token)
            .await
            .map_err(
                |source| AccessTokenSubstrateResourceServiceError::OAuthResourceServer { source },
            )?;

        Ok(Some(verified.to_resource_token_principal()))
    }
}
