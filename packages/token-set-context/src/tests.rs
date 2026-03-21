use chrono::{TimeDelta, Utc};
use http::HeaderMap;

use crate::{
    AeadRefreshMaterialProtector, AuthStateMetadataSnapshot, AuthStateSnapshot, AuthTokenSnapshot,
    AuthenticatedPrincipal, AuthenticationSource, AuthenticationSourceKind,
    BearerPropagationPolicy, MetadataRedemptionId, MokaPendingAuthStateMetadataRedemptionConfig,
    MokaPendingAuthStateMetadataRedemptionStore, PassthroughRefreshMaterialProtector,
    PendingAuthStateMetadataRedemptionPayload, PendingAuthStateMetadataRedemptionStore,
    RefreshMaterialProtector, SealedRefreshMaterial, TokenPropagator, TokenPropagatorConfig,
    TokenPropagatorError, TokenSetContext, TokenSetContextConfig, TokenSetRedirectUriConfig,
    TokenSetRedirectUriResolver, TokenSetRedirectUriRule, context::TokenSetContextResult,
};

#[test]
fn refresh_material_debug_is_redacted() {
    let value = SealedRefreshMaterial::new("sealed-token");

    assert_eq!(format!("{value:?}"), "SealedRefreshMaterial(REDACTED)");
    assert_eq!(value.expose(), "sealed-token");
}

#[test]
fn auth_token_snapshot_marks_expiring_token_for_refresh() {
    let now = Utc::now();
    let token_snapshot = AuthTokenSnapshot::builder()
        .access_token("access-token")
        .access_token_expires_at(now + TimeDelta::seconds(30))
        .build();

    assert!(token_snapshot.should_refresh_at(now));
    assert!(!token_snapshot.access_token_is_expired_at(now));
}

#[test]
fn auth_token_snapshot_applies_authorization_header() {
    let token_snapshot = AuthTokenSnapshot::builder()
        .access_token("access-token")
        .build();
    let mut headers = HeaderMap::new();

    token_snapshot
        .apply_authorization_header(&mut headers)
        .expect("header should be valid");

    assert_eq!(headers["authorization"], "Bearer access-token");
}

#[test]
fn auth_state_snapshot_builder_supports_principal_source_and_policy() {
    let auth_state = AuthStateSnapshot::builder()
        .tokens(
            AuthTokenSnapshot::builder()
                .access_token("access-token")
                .id_token("id-token")
                .refresh_material(SealedRefreshMaterial::new("sealed-refresh"))
                .build(),
        )
        .metadata(
            AuthStateMetadataSnapshot::builder()
                .source(
                    AuthenticationSource::builder()
                        .kind(AuthenticationSourceKind::OidcAuthorizationCode)
                        .provider_id("primary")
                        .issuer("https://issuer.example.com")
                        .build(),
                )
                .principal(
                    AuthenticatedPrincipal::builder()
                        .subject("user-123")
                        .display_name("Alice")
                        .issuer("https://issuer.example.com")
                        .build(),
                )
                .bearer_propagation_policy(BearerPropagationPolicy::TransparentForward)
                .build(),
        )
        .build();

    assert_eq!(auth_state.tokens.id_token.as_deref(), Some("id-token"));
    assert_eq!(
        auth_state
            .tokens
            .refresh_material
            .as_ref()
            .map(|v| v.expose()),
        Some("sealed-refresh")
    );
    assert_eq!(
        auth_state.metadata.source.kind,
        AuthenticationSourceKind::OidcAuthorizationCode
    );
    assert_eq!(
        auth_state.metadata.bearer_propagation_policy,
        BearerPropagationPolicy::TransparentForward
    );
}

#[test]
fn passthrough_protector_round_trips_plaintext() {
    let protector = PassthroughRefreshMaterialProtector;
    let sealed = protector
        .seal("refresh-token")
        .expect("seal should succeed");

    assert_eq!(sealed.expose(), "refresh-token");
    assert_eq!(
        protector.unseal(&sealed).expect("unseal should succeed"),
        "refresh-token"
    );
}

#[test]
fn aead_protector_round_trips_base64_material() {
    let protector =
        AeadRefreshMaterialProtector::from_master_key("01234567890123456789012345678901")
            .expect("master key should parse");
    let sealed = protector
        .seal("refresh-token")
        .expect("seal should succeed");

    assert_ne!(sealed.expose(), "refresh-token");
    assert!(
        sealed
            .expose()
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    );
    assert_eq!(
        protector.unseal(&sealed).expect("unseal should succeed"),
        "refresh-token"
    );
}

#[test]
fn token_set_context_config_requires_master_key_when_sealing_is_enabled() {
    let error = TokenSetContextConfig::<MokaPendingAuthStateMetadataRedemptionConfig> {
        master_key: None,
        sealed_refresh_token: true,
        ..Default::default()
    }
    .validate()
    .expect_err("config should be rejected");

    assert!(format!("{error}").contains("master_key is required"));
}

#[test]
fn token_set_context_round_trips_refresh_token() -> TokenSetContextResult<()> {
    let context = TokenSetContext::<MokaPendingAuthStateMetadataRedemptionStore>::from_config(
        TokenSetContextConfig {
            master_key: Some("01234567890123456789012345678901".to_string()),
            sealed_refresh_token: true,
            ..Default::default()
        },
    )?;
    let sealed = context
        .seal_refresh_token("refresh-token")
        .expect("seal should succeed");

    assert_eq!(
        context
            .unseal_refresh_token(&sealed)
            .expect("unseal should succeed"),
        "refresh-token"
    );

    Ok(())
}

#[test]
fn token_propagator_uses_server_default_policy_by_default() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        default_policy: BearerPropagationPolicy::ValidateThenForward,
        trust_auth_state_policy: false,
    })
    .expect("propagator should build");
    let auth_state = AuthStateSnapshot::builder()
        .tokens(
            AuthTokenSnapshot::builder()
                .access_token("access-token")
                .build(),
        )
        .metadata(
            AuthStateMetadataSnapshot::builder()
                .bearer_propagation_policy(BearerPropagationPolicy::TransparentForward)
                .build(),
        )
        .build();

    assert_eq!(
        propagator.resolve_policy(&auth_state),
        BearerPropagationPolicy::ValidateThenForward
    );
}

#[test]
fn token_propagator_can_opt_into_auth_state_policy() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        default_policy: BearerPropagationPolicy::ValidateThenForward,
        trust_auth_state_policy: true,
    })
    .expect("propagator should build");
    let auth_state = AuthStateSnapshot::builder()
        .tokens(
            AuthTokenSnapshot::builder()
                .access_token("access-token")
                .build(),
        )
        .metadata(
            AuthStateMetadataSnapshot::builder()
                .bearer_propagation_policy(BearerPropagationPolicy::TransparentForward)
                .build(),
        )
        .build();

    assert_eq!(
        propagator.resolve_policy(&auth_state),
        BearerPropagationPolicy::TransparentForward
    );
}

#[test]
fn token_propagator_rejects_direct_header_for_exchange_policy() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        default_policy: BearerPropagationPolicy::ExchangeForDownstreamToken,
        trust_auth_state_policy: false,
    })
    .expect("propagator should build");
    let auth_state = AuthStateSnapshot::builder()
        .tokens(
            AuthTokenSnapshot::builder()
                .access_token("access-token")
                .build(),
        )
        .metadata(AuthStateMetadataSnapshot::default())
        .build();

    let error = propagator
        .authorization_header_value(&auth_state)
        .expect_err("exchange policy should not attach a direct header");

    assert!(matches!(
        error,
        TokenPropagatorError::UnsupportedDirectAuthorization { .. }
    ));
}

#[test]
fn metadata_redemption_store_redeems_once() -> TokenSetContextResult<()> {
    let store = MokaPendingAuthStateMetadataRedemptionStore::from_config(
        &MokaPendingAuthStateMetadataRedemptionConfig::default(),
    )?;
    let now = Utc::now();
    let issued = store
        .issue(
            PendingAuthStateMetadataRedemptionPayload::Delta(
                crate::AuthStateMetadataDelta::default(),
            ),
            now,
        )
        .expect("issue should succeed");

    let redeemed = store
        .redeem(&issued.id, now)
        .expect("redeem should succeed");
    let redeemed_again = store
        .redeem(&issued.id, now)
        .expect("second redeem should succeed");

    assert!(matches!(
        redeemed,
        Some(PendingAuthStateMetadataRedemptionPayload::Delta(_))
    ));
    assert!(redeemed_again.is_none());

    Ok(())
}

#[test]
fn metadata_redemption_store_drops_expired_entries() -> TokenSetContextResult<()> {
    let store = MokaPendingAuthStateMetadataRedemptionStore::from_config(
        &MokaPendingAuthStateMetadataRedemptionConfig {
            ttl: std::time::Duration::from_millis(10),
            ..Default::default()
        },
    )?;
    let now = Utc::now();
    let issued = store
        .issue(
            PendingAuthStateMetadataRedemptionPayload::Delta(
                crate::AuthStateMetadataDelta::default(),
            ),
            now,
        )
        .expect("issue should succeed");
    std::thread::sleep(std::time::Duration::from_millis(30));

    let redeemed = store
        .redeem(
            &MetadataRedemptionId::new(issued.id.expose().to_string()),
            now + TimeDelta::seconds(2),
        )
        .expect("redeem should succeed");

    assert!(redeemed.is_none());

    Ok(())
}

#[test]
fn redirect_uri_config_resolves_dynamic_allowed_redirect() {
    let redirect_uri = TokenSetRedirectUriResolver::from_config(TokenSetRedirectUriConfig {
        default_redirect_uri: Some("https://app.example.com/default".to_string()),
        dynamic_redirect_uri_enabled: true,
        allowed_redirect_uris: vec![TokenSetRedirectUriRule::Regex {
            value: regex::Regex::new(r"^https://app\.example\.com/callback(/.*)?$")
                .expect("regex should compile"),
        }],
        ..Default::default()
    })
    .resolve_redirect_uri(Some("https://app.example.com/callback/tenant-a"))
    .expect("redirect should be allowed");

    assert_eq!(
        redirect_uri.as_str(),
        "https://app.example.com/callback/tenant-a"
    );
}
