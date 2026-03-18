use std::collections::HashMap;

use securitydept_oidc_client::{OidcCodeCallbackResult, OidcRefreshTokenResult};
use serde_json::{Value, json};
use typed_builder::TypedBuilder;

use crate::{
    AuthStateMetadataSnapshot, AuthStateSnapshot, AuthTokenSnapshot, AuthenticatedPrincipal,
    AuthenticationSource, AuthenticationSourceKind, BearerPropagationPolicy, SealedRefreshMaterial,
    TokenSetContext, TokenSetContextError,
};

#[derive(Debug, Clone, PartialEq, Eq, TypedBuilder, Default)]
pub struct OidcAuthStateOptions {
    #[builder(default, setter(strip_option, into))]
    pub provider_id: Option<String>,
    #[builder(default, setter(strip_option))]
    pub bearer_propagation_policy: Option<BearerPropagationPolicy>,
    #[builder(default)]
    pub source_attributes: HashMap<String, Value>,
    #[builder(default)]
    pub metadata_attributes: HashMap<String, Value>,
}

impl TokenSetContext {
    pub fn auth_state_snapshot_from_code_callback(
        &self,
        result: &OidcCodeCallbackResult,
        options: &OidcAuthStateOptions,
    ) -> Result<AuthStateSnapshot, TokenSetContextError> {
        let mut source_attributes = options.source_attributes.clone();
        push_source_kind_history(
            &mut source_attributes,
            &AuthenticationSourceKind::OidcAuthorizationCode,
        );

        Ok(AuthStateSnapshot {
            tokens: AuthTokenSnapshot {
                access_token: result.access_token.clone(),
                id_token: Some(result.id_token.clone()),
                refresh_material: seal_optional_refresh_material(
                    self,
                    result.refresh_token.as_deref(),
                )?,
                access_token_expires_at: result.access_token_expiration,
            },
            metadata: AuthStateMetadataSnapshot {
                principal: Some(principal_from_code_callback(result)),
                source: AuthenticationSource {
                    kind: AuthenticationSourceKind::OidcAuthorizationCode,
                    provider_id: options.provider_id.clone(),
                    issuer: Some(result.id_token_claims.issuer().url().to_string()),
                    attributes: source_attributes,
                },
                bearer_propagation_policy: options
                    .bearer_propagation_policy
                    .clone()
                    .unwrap_or(BearerPropagationPolicy::ValidateThenForward),
                attributes: options.metadata_attributes.clone(),
            },
        })
    }

    pub fn auth_state_snapshot_from_refresh_result(
        &self,
        current: &AuthStateSnapshot,
        result: &OidcRefreshTokenResult,
    ) -> Result<AuthStateSnapshot, TokenSetContextError> {
        let mut source = current.metadata.source.clone();
        source.kind = AuthenticationSourceKind::RefreshToken;
        push_source_kind_history(
            &mut source.attributes,
            &AuthenticationSourceKind::RefreshToken,
        );

        if let Some(id_token_claims) = result.id_token_claims.as_ref() {
            source.issuer = Some(id_token_claims.issuer().url().to_string());
        }

        Ok(AuthStateSnapshot {
            tokens: AuthTokenSnapshot {
                access_token: result.access_token.clone(),
                id_token: result
                    .id_token
                    .clone()
                    .or_else(|| current.tokens.id_token.clone()),
                refresh_material: match result.refresh_token.as_deref() {
                    Some(refresh_token) => Some(self.seal_refresh_token(refresh_token)?),
                    None => current.tokens.refresh_material.clone(),
                },
                access_token_expires_at: result.access_token_expiration,
            },
            metadata: AuthStateMetadataSnapshot {
                principal: principal_from_refresh_result(result)
                    .or_else(|| current.metadata.principal.clone()),
                source,
                bearer_propagation_policy: current.metadata.bearer_propagation_policy.clone(),
                attributes: current.metadata.attributes.clone(),
            },
        })
    }
}

fn principal_from_code_callback(result: &OidcCodeCallbackResult) -> AuthenticatedPrincipal {
    AuthenticatedPrincipal {
        subject: result.id_token_claims.subject().to_string(),
        display_name: result.claims_check_result.display_name.clone(),
        picture: result.claims_check_result.picture.clone(),
        issuer: Some(result.id_token_claims.issuer().url().to_string()),
        claims: result.claims_check_result.claims.clone(),
    }
}

fn principal_from_refresh_result(
    result: &OidcRefreshTokenResult,
) -> Option<AuthenticatedPrincipal> {
    let claims_check_result = result.claims_check_result.as_ref()?;
    let id_token_claims = result.id_token_claims.as_ref()?;

    Some(AuthenticatedPrincipal {
        subject: id_token_claims.subject().to_string(),
        display_name: claims_check_result.display_name.clone(),
        picture: claims_check_result.picture.clone(),
        issuer: Some(id_token_claims.issuer().url().to_string()),
        claims: claims_check_result.claims.clone(),
    })
}

fn push_source_kind_history(
    attributes: &mut HashMap<String, Value>,
    kind: &AuthenticationSourceKind,
) {
    let kind_value = source_kind_value(kind);
    let history = attributes
        .entry("source_kind_history".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));

    match history {
        Value::Array(entries) => {
            if entries.last() != Some(&kind_value) {
                entries.push(kind_value);
            }
        }
        _ => {
            *history = Value::Array(vec![kind_value]);
        }
    }
}

fn source_kind_value(kind: &AuthenticationSourceKind) -> Value {
    match kind {
        AuthenticationSourceKind::OidcAuthorizationCode => json!("oidc_authorization_code"),
        AuthenticationSourceKind::RefreshToken => json!("refresh_token"),
        AuthenticationSourceKind::ForwardedBearer => json!("forwarded_bearer"),
        AuthenticationSourceKind::StaticToken => json!("static_token"),
        AuthenticationSourceKind::Unknown => json!("unknown"),
    }
}

fn seal_optional_refresh_material(
    context: &TokenSetContext,
    refresh_token: Option<&str>,
) -> Result<Option<SealedRefreshMaterial>, TokenSetContextError> {
    refresh_token
        .map(|value| context.seal_refresh_token(value))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::{push_source_kind_history, source_kind_value};
    use crate::AuthenticationSourceKind;

    #[test]
    fn source_kind_history_appends_new_kinds() {
        let mut attributes = std::collections::HashMap::new();

        push_source_kind_history(
            &mut attributes,
            &AuthenticationSourceKind::OidcAuthorizationCode,
        );
        push_source_kind_history(&mut attributes, &AuthenticationSourceKind::RefreshToken);

        assert_eq!(
            attributes.get("source_kind_history"),
            Some(&serde_json::json!([
                "oidc_authorization_code",
                "refresh_token"
            ]))
        );
    }

    #[test]
    fn source_kind_history_merges_same_top_kind() {
        let mut attributes = std::collections::HashMap::from([(
            "source_kind_history".to_string(),
            serde_json::json!(["refresh_token"]),
        )]);

        push_source_kind_history(&mut attributes, &AuthenticationSourceKind::RefreshToken);

        assert_eq!(
            attributes.get("source_kind_history"),
            Some(&serde_json::json!(["refresh_token"]))
        );
        assert_eq!(
            source_kind_value(&AuthenticationSourceKind::RefreshToken),
            serde_json::json!("refresh_token")
        );
    }
}
