use oauth2::TokenIntrospectionResponse;

use crate::{
    OAuthResourceServerError, OAuthResourceServerIntrospectionConfig, OAuthResourceServerMetadata,
    OAuthResourceServerResult, VerificationPolicy, VerifiedOpaqueToken,
};

pub(super) struct OAuthResourceServerVerifierIntrospection {
    config: OAuthResourceServerIntrospectionConfig,
}

impl OAuthResourceServerVerifierIntrospection {
    pub fn from_config(config: &OAuthResourceServerIntrospectionConfig) -> Self {
        Self {
            config: config.clone(),
        }
    }

    pub async fn introspect(
        &self,
        token: &str,
        provider: &securitydept_oauth_provider::OAuthProviderRuntime,
        policy: &VerificationPolicy,
    ) -> OAuthResourceServerResult<VerifiedOpaqueToken> {
        let metadata = provider.metadata().await?;
        let response = provider
            .introspect(
                self.config.client_id.as_deref().unwrap_or_default(),
                self.config.client_secret.as_deref(),
                token,
                self.config.token_type_hint.as_deref(),
            )
            .await?;

        let resource_metadata = OAuthResourceServerMetadata {
            issuer: metadata.issuer,
            jwks_uri: metadata.jwks_uri,
            introspection_url: metadata.introspection_endpoint,
        };

        validate_introspection_response(&response, &resource_metadata, policy)?;

        Ok(VerifiedOpaqueToken {
            response,
            metadata: resource_metadata,
        })
    }
}

fn validate_introspection_response(
    response: &openidconnect::core::CoreTokenIntrospectionResponse,
    metadata: &OAuthResourceServerMetadata,
    policy: &VerificationPolicy,
) -> OAuthResourceServerResult<()> {
    if !response.active() {
        return Err(OAuthResourceServerError::PolicyViolation {
            message: "Opaque token is not active".to_string(),
        });
    }

    if let Some(issuer) = response.iss()
        && issuer != metadata.issuer.as_str()
    {
        return Err(OAuthResourceServerError::PolicyViolation {
            message: format!(
                "Opaque token issuer mismatch: expected {}, got {issuer}",
                metadata.issuer
            ),
        });
    }

    if !policy.allowed_audiences().is_empty() {
        let audience = response
            .aud()
            .ok_or_else(|| OAuthResourceServerError::PolicyViolation {
                message: "Opaque token is missing audience".to_string(),
            })?;
        let has_match = audience.iter().any(|value| {
            policy
                .allowed_audiences()
                .iter()
                .any(|expected| expected == value)
        });
        if !has_match {
            return Err(OAuthResourceServerError::PolicyViolation {
                message: "Opaque token audience does not satisfy verifier policy".to_string(),
            });
        }
    }

    if !policy.required_scopes().is_empty() {
        let scopes =
            response
                .scopes()
                .ok_or_else(|| OAuthResourceServerError::PolicyViolation {
                    message: "Opaque token is missing scopes".to_string(),
                })?;
        let has_all = policy
            .required_scopes()
            .iter()
            .all(|required| scopes.iter().any(|scope| scope.as_ref() == required));
        if !has_all {
            return Err(OAuthResourceServerError::PolicyViolation {
                message: format!(
                    "Opaque token is missing one or more required scopes: {}",
                    policy.required_scopes().join(", ")
                ),
            });
        }
    }

    Ok(())
}
