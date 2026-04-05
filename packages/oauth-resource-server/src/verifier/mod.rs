mod introspection;
#[cfg(feature = "jwe")]
mod jwe;
#[cfg(feature = "jwe")]
mod watcher;

use std::sync::Arc;

use securitydept_creds::{JwtClaimsTrait, JwtValidation, TokenData, TokenFormat, TokenJwtClaims};
use tracing::debug;

use self::introspection::OAuthResourceServerVerifierIntrospection;
#[cfg(feature = "jwe")]
use self::jwe::OAuthResourceServerVerifierJwe;
use crate::{
    OAuthResourceServerConfig, OAuthResourceServerError, OAuthResourceServerMetadata,
    OAuthResourceServerResult, VerificationPolicy, VerifiedAccessToken, VerifiedOpaqueToken,
    VerifiedToken, models::scope_contains_all,
};

pub struct OAuthResourceServerVerifier {
    provider: Arc<securitydept_oauth_provider::OAuthProviderRuntime>,
    policy: VerificationPolicy,
    introspection: Option<OAuthResourceServerVerifierIntrospection>,
    #[cfg(feature = "jwe")]
    jwe: Option<OAuthResourceServerVerifierJwe>,
}

impl OAuthResourceServerVerifier {
    pub async fn from_config(config: OAuthResourceServerConfig) -> OAuthResourceServerResult<Self> {
        config.validate()?;
        let provider = Arc::new(
            securitydept_oauth_provider::OAuthProviderRuntime::from_config(
                config.provider_config(),
            )
            .await?,
        );
        Self::from_provider(provider, config).await
    }

    pub async fn from_provider(
        provider: Arc<securitydept_oauth_provider::OAuthProviderRuntime>,
        config: OAuthResourceServerConfig,
    ) -> OAuthResourceServerResult<Self> {
        config.validate()?;

        Ok(Self {
            provider,
            policy: VerificationPolicy::new(
                config.audiences.clone(),
                config.required_scopes.clone(),
                config.clock_skew,
            ),
            introspection: config
                .introspection
                .as_ref()
                .map(OAuthResourceServerVerifierIntrospection::from_config),
            #[cfg(feature = "jwe")]
            jwe: match config.jwe.as_ref() {
                Some(jwe_config) => {
                    Some(OAuthResourceServerVerifierJwe::from_config(jwe_config).await?)
                }
                None => None,
            },
        })
    }

    pub async fn metadata(&self) -> OAuthResourceServerResult<OAuthResourceServerMetadata> {
        let metadata = self.provider.metadata().await?;
        Ok(OAuthResourceServerMetadata {
            issuer: metadata.issuer,
            jwks_uri: metadata.jwks_uri,
            introspection_url: metadata.introspection_endpoint,
        })
    }

    pub fn policy(&self) -> &VerificationPolicy {
        &self.policy
    }

    pub fn provider(&self) -> &Arc<securitydept_oauth_provider::OAuthProviderRuntime> {
        &self.provider
    }

    pub async fn verify_token<CLAIMS>(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<VerifiedToken<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        match TokenFormat::from_token(token) {
            TokenFormat::Opaque => Ok(VerifiedToken::from(
                self.verify_opaque_access_token(token).await?,
            )),
            _ => Ok(VerifiedToken::from(self.verify_access_token(token).await?)),
        }
    }

    pub async fn verify_opaque_access_token(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<VerifiedOpaqueToken> {
        self.introspection
            .as_ref()
            .ok_or(OAuthResourceServerError::UnsupportedTokenFormat {
                token_format: TokenFormat::Opaque,
            })?
            .introspect(token, &self.provider, &self.policy)
            .await
    }

    pub async fn verify_rfc9068_access_token(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<VerifiedAccessToken<TokenJwtClaims>> {
        let token_data = self
            .verify_structured_token_data::<TokenJwtClaims>(token)
            .await?;
        validate_rfc9068_scope_policy(&token_data, &self.policy)?;

        Ok(VerifiedAccessToken {
            token_data,
            metadata: self.metadata().await?,
        })
    }

    pub async fn verify_access_token<CLAIMS>(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<VerifiedAccessToken<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        let token_data = self.verify_structured_token_data::<CLAIMS>(token).await?;

        Ok(VerifiedAccessToken {
            token_data,
            metadata: self.metadata().await?,
        })
    }

    async fn verify_structured_token_data<CLAIMS>(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<TokenData<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        match TokenFormat::from_token(token) {
            TokenFormat::JWT => self.verify_jwt_token_data(token).await,
            TokenFormat::Opaque => Err(OAuthResourceServerError::UnsupportedTokenFormat {
                token_format: TokenFormat::Opaque,
            }),
            TokenFormat::JWE => self.verify_jwe_token_data(token).await,
        }
    }

    async fn verify_jwt_token_data<CLAIMS>(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<TokenData<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        match self.verify_jwt_with_current_jwks(token).await {
            Ok(token_data) => Ok(token_data),
            Err(error) if should_retry_with_refreshed_jwks(&error) => {
                debug!("Retrying access token verification after JWKS refresh");
                let metadata = self.provider.refresh_jwks().await?;
                verify_jwt_with_policy::<CLAIMS>(
                    token,
                    &metadata.jwks,
                    &OAuthResourceServerMetadata {
                        issuer: metadata.issuer,
                        jwks_uri: metadata.jwks_uri,
                        introspection_url: metadata.introspection_endpoint,
                    },
                    &self.policy,
                )
            }
            Err(error) => Err(error),
        }
    }

    async fn verify_jwt_with_current_jwks<CLAIMS>(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<TokenData<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        let metadata = self.provider.metadata().await?;
        let resource_metadata = OAuthResourceServerMetadata {
            issuer: metadata.issuer.clone(),
            jwks_uri: metadata.jwks_uri.clone(),
            introspection_url: metadata.introspection_endpoint.clone(),
        };
        verify_jwt_with_policy::<CLAIMS>(token, &metadata.jwks, &resource_metadata, &self.policy)
    }

    async fn verify_jwe_token_data<CLAIMS>(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<TokenData<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        #[cfg(feature = "jwe")]
        {
            return match self.verify_jwe_with_current_jwks(token).await {
                Ok(token_data) => Ok(token_data),
                Err(error) if should_retry_with_refreshed_jwks(&error) => {
                    debug!("Retrying JWE access token verification after JWKS refresh");
                    let metadata = self.provider.refresh_jwks().await?;
                    self.jwe
                        .as_ref()
                        .ok_or(OAuthResourceServerError::UnsupportedTokenFormat {
                            token_format: TokenFormat::JWE,
                        })?
                        .verify_token_data::<CLAIMS>(
                            token,
                            &metadata.jwks,
                            &OAuthResourceServerMetadata {
                                issuer: metadata.issuer,
                                jwks_uri: metadata.jwks_uri,
                                introspection_url: metadata.introspection_endpoint,
                            },
                            &self.policy,
                        )
                        .await
                }
                Err(error) => Err(error),
            };
        }

        #[cfg(not(feature = "jwe"))]
        {
            let _ = token;
            Err(OAuthResourceServerError::UnsupportedTokenFormat {
                token_format: TokenFormat::JWE,
            })
        }
    }

    #[cfg(feature = "jwe")]
    async fn verify_jwe_with_current_jwks<CLAIMS>(
        &self,
        token: &str,
    ) -> OAuthResourceServerResult<TokenData<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        let metadata = self.provider.metadata().await?;
        self.jwe
            .as_ref()
            .ok_or(OAuthResourceServerError::UnsupportedTokenFormat {
                token_format: TokenFormat::JWE,
            })?
            .verify_token_data::<CLAIMS>(
                token,
                &metadata.jwks,
                &OAuthResourceServerMetadata {
                    issuer: metadata.issuer,
                    jwks_uri: metadata.jwks_uri,
                    introspection_url: metadata.introspection_endpoint,
                },
                &self.policy,
            )
            .await
    }
}

#[cfg(not(feature = "jwe"))]
fn verify_jwt_with_policy<CLAIMS>(
    token: &str,
    jwks: &openidconnect::core::CoreJsonWebKeySet,
    metadata: &OAuthResourceServerMetadata,
    policy: &VerificationPolicy,
) -> OAuthResourceServerResult<TokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
{
    securitydept_creds::verify_token_rfc9068_with_jwks_without_jwe(
        token,
        jwks,
        |mut validation: JwtValidation| {
            apply_validation_policy(&mut validation, metadata, policy);
            Ok(validation)
        },
    )
    .map_err(|source| OAuthResourceServerError::TokenValidation { source })
}

#[cfg(feature = "jwe")]
fn verify_jwt_with_policy<CLAIMS>(
    token: &str,
    jwks: &openidconnect::core::CoreJsonWebKeySet,
    metadata: &OAuthResourceServerMetadata,
    policy: &VerificationPolicy,
) -> OAuthResourceServerResult<TokenData<CLAIMS>>
where
    CLAIMS: JwtClaimsTrait,
{
    use crate::LocalJweDecryptionKeySet;

    securitydept_creds::verify_token_rfc9068_with_jwks(
        token,
        jwks,
        &LocalJweDecryptionKeySet::new(Vec::new()),
        |mut validation: JwtValidation| {
            apply_validation_policy(&mut validation, metadata, policy);
            Ok(validation)
        },
    )
    .map_err(|source| OAuthResourceServerError::TokenValidation { source })
}

pub(super) fn apply_validation_policy(
    validation: &mut JwtValidation,
    metadata: &OAuthResourceServerMetadata,
    policy: &VerificationPolicy,
) {
    validation.leeway = policy.clock_skew().as_secs();
    validation.validate_nbf = true;
    validation.set_required_spec_claims(&["exp", "iss"]);
    validation.set_issuer(&[metadata.issuer.as_str()]);
    if !policy.allowed_audiences().is_empty() {
        validation.set_audience(policy.allowed_audiences());
    } else {
        validation.validate_aud = false;
    }
}

fn validate_rfc9068_scope_policy(
    token_data: &TokenData<TokenJwtClaims>,
    policy: &VerificationPolicy,
) -> OAuthResourceServerResult<()> {
    match token_data {
        TokenData::JWT(data) => validate_scope_policy(data.claims.scope.as_ref(), policy),
        #[cfg(feature = "jwe")]
        TokenData::JWE(data) => validate_scope_policy(data.claims().scope.as_ref(), policy),
        #[cfg(not(feature = "jwe"))]
        TokenData::JWE => Err(OAuthResourceServerError::UnsupportedTokenFormat {
            token_format: TokenFormat::JWE,
        }),
        TokenData::Opaque => Err(OAuthResourceServerError::UnsupportedTokenFormat {
            token_format: TokenFormat::Opaque,
        }),
    }
}

fn validate_scope_policy(
    scope: Option<&securitydept_creds::Scope>,
    policy: &VerificationPolicy,
) -> OAuthResourceServerResult<()> {
    if scope_contains_all(scope, policy.required_scopes()) {
        return Ok(());
    }

    Err(OAuthResourceServerError::PolicyViolation {
        message: if policy.required_scopes().is_empty() {
            "Access token scopes failed policy validation".to_string()
        } else {
            format!(
                "Access token is missing one or more required scopes: {}",
                policy.required_scopes().join(", ")
            )
        },
    })
}

fn should_retry_with_refreshed_jwks(error: &OAuthResourceServerError) -> bool {
    matches!(
        error,
        OAuthResourceServerError::TokenValidation {
            source: securitydept_creds::CredsError::InvalidCredentialsFormat { .. }
        }
    )
}
