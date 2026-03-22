use std::collections::HashMap;

use securitydept_oidc_client::{OidcCodeCallbackResult, OidcRefreshTokenResult};
use serde_json::Value;
use typed_builder::TypedBuilder;

use crate::{
    AuthStateMetadataDelta, AuthStateMetadataSnapshot, AuthStateSnapshot, AuthTokenSnapshot,
    AuthenticatedPrincipal, AuthenticationSource, AuthenticationSourceKind,
    CurrentAuthStateMetadataSnapshotPartial, CurrentAuthenticationSourcePartial,
    PendingAuthStateMetadataRedemptionStore, SealedRefreshMaterial, TokenSetContext,
    TokenSetContextError,
};

#[derive(Debug, Clone, PartialEq, Eq, TypedBuilder, Default)]
pub struct OidcAuthStateOptions {
    #[builder(default, setter(strip_option, into))]
    pub source_provider_id: Option<String>,
    #[builder(default)]
    pub source_attributes: HashMap<String, Value>,
    #[builder(default)]
    pub metadata_attributes: HashMap<String, Value>,
}

impl<MS> TokenSetContext<MS>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    pub fn auth_state_snapshot_from_code_callback(
        &self,
        result: &OidcCodeCallbackResult,
        options: &OidcAuthStateOptions,
    ) -> Result<AuthStateSnapshot, TokenSetContextError> {
        let mut kind_history = Vec::new();
        push_kind_history(
            &mut kind_history,
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
                    provider_id: options.source_provider_id.clone(),
                    issuer: Some(result.id_token_claims.issuer().url().to_string()),
                    kind_history,
                    attributes: options.source_attributes.clone(),
                },
                attributes: options.metadata_attributes.clone(),
            },
        })
    }

    pub fn auth_state_metadata_delta_from_refresh_result(
        current_metadata: Option<&CurrentAuthStateMetadataSnapshotPartial>,
        result: &OidcRefreshTokenResult,
    ) -> AuthStateMetadataDelta {
        AuthStateMetadataDelta {
            principal: principal_from_refresh_result(result),
            source: Some(refreshed_source(
                current_metadata.and_then(|metadata| metadata.source.as_ref()),
                result,
            )),
            ..Default::default()
        }
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

fn refreshed_source(
    current_source: Option<&CurrentAuthenticationSourcePartial>,
    result: &OidcRefreshTokenResult,
) -> AuthenticationSource {
    let mut source = AuthenticationSource {
        kind: AuthenticationSourceKind::RefreshToken,
        provider_id: current_source.and_then(|source| source.provider_id.clone()),
        issuer: current_source.and_then(|source| source.issuer.clone()),
        kind_history: current_source
            .and_then(|source| source.kind_history.as_ref())
            .cloned()
            .unwrap_or_default(),
        attributes: current_source
            .map(|source| source.attributes.clone())
            .unwrap_or_default(),
    };
    push_kind_history(
        &mut source.kind_history,
        &AuthenticationSourceKind::RefreshToken,
    );

    if let Some(id_token_claims) = result.id_token_claims.as_ref() {
        source.issuer = Some(id_token_claims.issuer().url().to_string());
    }

    source
}

fn push_kind_history(history: &mut Vec<AuthenticationSourceKind>, kind: &AuthenticationSourceKind) {
    if history.last() != Some(kind) {
        history.push(kind.clone());
    }
}

fn seal_optional_refresh_material<MS>(
    context: &TokenSetContext<MS>,
    refresh_token: Option<&str>,
) -> Result<Option<SealedRefreshMaterial>, TokenSetContextError>
where
    MS: PendingAuthStateMetadataRedemptionStore,
{
    refresh_token
        .map(|value| context.seal_refresh_token(value))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::{push_kind_history, refreshed_source};
    use crate::{
        AuthStateMetadataDelta, AuthenticationSourceKind, CurrentAuthenticationSourcePartial,
    };

    #[test]
    fn kind_history_appends_new_kinds() {
        let mut history = Vec::new();

        push_kind_history(
            &mut history,
            &AuthenticationSourceKind::OidcAuthorizationCode,
        );
        push_kind_history(&mut history, &AuthenticationSourceKind::RefreshToken);

        assert_eq!(
            history,
            vec![
                AuthenticationSourceKind::OidcAuthorizationCode,
                AuthenticationSourceKind::RefreshToken
            ]
        );
    }

    #[test]
    fn kind_history_merges_same_top_kind() {
        let mut history = vec![AuthenticationSourceKind::RefreshToken];

        push_kind_history(&mut history, &AuthenticationSourceKind::RefreshToken);

        assert_eq!(history, vec![AuthenticationSourceKind::RefreshToken]);
    }

    #[test]
    fn metadata_delta_is_generated_without_previous_snapshot() {
        let delta: AuthStateMetadataDelta = AuthStateMetadataDelta {
            source: Some(refreshed_source(None, &mock_refresh_result())),
            ..Default::default()
        };

        assert_eq!(
            delta.source.as_ref().map(|source| &source.kind),
            Some(&AuthenticationSourceKind::RefreshToken)
        );
        assert_eq!(
            delta.source.as_ref().map(|source| &source.kind_history),
            Some(&vec![AuthenticationSourceKind::RefreshToken])
        );
    }

    #[test]
    fn refreshed_source_preserves_partial_source_fields() {
        let source = refreshed_source(
            Some(&CurrentAuthenticationSourcePartial {
                provider_id: Some("primary".to_string()),
                issuer: Some("https://issuer.example.com".to_string()),
                kind_history: Some(vec![AuthenticationSourceKind::OidcAuthorizationCode]),
                ..Default::default()
            }),
            &mock_refresh_result(),
        );

        assert_eq!(source.provider_id.as_deref(), Some("primary"));
        assert_eq!(source.issuer.as_deref(), Some("https://issuer.example.com"));
        assert_eq!(
            source.kind_history,
            vec![
                AuthenticationSourceKind::OidcAuthorizationCode,
                AuthenticationSourceKind::RefreshToken
            ]
        );
    }

    fn mock_refresh_result() -> securitydept_oidc_client::OidcRefreshTokenResult {
        securitydept_oidc_client::OidcRefreshTokenResult {
            access_token: "access-token".to_string(),
            access_token_expiration: None,
            id_token: None,
            refresh_token: None,
            id_token_claims: None,
            user_info_claims: None,
            claims_check_result: None,
        }
    }
}
