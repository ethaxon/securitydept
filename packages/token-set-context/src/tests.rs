use std::sync::Arc;

use chrono::{TimeDelta, Utc};
use http::HeaderMap;
use regex::Regex;
use securitydept_oauth_resource_server::ResourceTokenPrincipal;
use serde_json::json;
use url::Url;

use crate::{
    AeadRefreshMaterialProtector, AllowedPropagationTarget, AuthStateMetadataSnapshot,
    AuthStateSnapshot, AuthTokenSnapshot, AuthenticatedPrincipal, AuthenticationSource,
    AuthenticationSourceKind, BearerPropagationPolicy, PassthroughRefreshMaterialProtector,
    PropagatedBearer, PropagatedTokenValidationConfig, PropagationDestinationPolicy,
    PropagationDirective, PropagationRequestTarget, PropagationScheme, RefreshMaterialProtector,
    SealedRefreshMaterial, TokenPropagator, TokenPropagatorConfig, TokenPropagatorError,
    TokenSetRedirectUriConfig, TokenSetRedirectUriResolver, TokenSetRedirectUriRule,
};
#[cfg(feature = "moka-pending-store")]
use crate::{
    MetadataRedemptionId, MokaPendingAuthStateMetadataRedemptionConfig,
    MokaPendingAuthStateMetadataRedemptionStore, PendingAuthStateMetadataRedemptionPayload,
    PendingAuthStateMetadataRedemptionStore, MediatedContext, MediatedContextConfig,
    error::MediatedContextResult,
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
fn auth_state_snapshot_builder_supports_principal_and_source() {
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

#[cfg(feature = "moka-pending-store")]
#[test]
fn mediated_context_config_requires_master_key_when_sealing_is_enabled() {
    let error = MediatedContextConfig::<MokaPendingAuthStateMetadataRedemptionConfig> {
        master_key: None,
        sealed_refresh_token: true,
        ..Default::default()
    }
    .validate()
    .expect_err("config should be rejected");

    assert!(format!("{error}").contains("master_key is required"));
}

#[cfg(feature = "moka-pending-store")]
#[test]
fn mediated_context_round_trips_refresh_token() -> MediatedContextResult<()> {
    let context = MediatedContext::<MokaPendingAuthStateMetadataRedemptionStore>::from_config(
        MediatedContextConfig {
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
        destination_policy: PropagationDestinationPolicy {
            allowed_node_ids: vec!["node-a".to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");
    assert_eq!(
        propagator.resolve_policy(),
        BearerPropagationPolicy::ValidateThenForward
    );
}

#[test]
fn token_propagator_rejects_direct_header_for_exchange_policy() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        default_policy: BearerPropagationPolicy::ExchangeForDownstreamToken,
        destination_policy: PropagationDestinationPolicy {
            allowed_node_ids: vec!["node-a".to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");
    let error = propagator
        .authorization_header_value(
            &PropagatedBearer {
                access_token: "access-token",
                resource_token_principal: None,
            },
            &PropagationRequestTarget::new(
                Some("node-a".to_string()),
                PropagationScheme::Https,
                "service.internal.example.com",
                443,
            ),
        )
        .expect_err("exchange policy should not attach a direct header");

    assert!(matches!(
        error,
        TokenPropagatorError::UnsupportedDirectAuthorization { .. }
    ));
}

#[test]
fn propagation_directive_round_trips_forwarded_style_value() {
    let directive = PropagationDirective::parse(
        "by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https",
    )
    .expect("directive should parse");

    assert_eq!(directive.by.as_deref(), Some("dashboard"));
    assert_eq!(directive.r#for.as_deref(), Some("node-a"));
    assert_eq!(directive.hostname, "service.internal.example.com");
    assert_eq!(directive.port, Some(443));
    assert_eq!(directive.proto, PropagationScheme::Https);

    let header_value = directive
        .to_header_value()
        .expect("directive should serialize");
    assert_eq!(
        header_value.to_str().expect("header value should be ascii"),
        "by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https"
    );
}

#[test]
fn propagation_directive_maps_to_request_target_with_default_port() {
    let directive =
        PropagationDirective::parse("for=node-a;host=service.internal.example.com;proto=https")
            .expect("directive should parse");

    let target = directive.to_request_target();
    assert_eq!(target.node_id.as_deref(), Some("node-a"));
    assert_eq!(target.scheme, Some(PropagationScheme::Https));
    assert_eq!(
        target.hostname.as_deref(),
        Some("service.internal.example.com")
    );
    assert_eq!(target.port, None);
}

#[test]
fn token_propagator_allows_matching_node_id_and_claims() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_node_ids: vec!["node-a".to_string()],
            ..Default::default()
        },
        token_validation: PropagatedTokenValidationConfig {
            required_issuers: vec!["https://issuer.example.com".to_string()],
            allowed_audiences: vec!["mesh-api".to_string()],
            required_scopes: vec!["mesh.forward".to_string()],
            allowed_azp: vec!["securitydept-web".to_string()],
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let target = PropagationRequestTarget::new(
        Some("node-a".to_string()),
        PropagationScheme::Https,
        "unlisted.internal.example.com",
        443,
    );
    let mut headers = HeaderMap::new();

    propagator
        .apply_authorization_header(&propagated_bearer_with_claims(), &target, &mut headers)
        .expect("target should be allowed");

    assert_eq!(headers["authorization"], "Bearer access-token");
}

#[test]
fn token_propagator_allows_missing_explicit_port_with_scheme_default() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                scheme: PropagationScheme::Https,
                hostname: "service.internal.example.com".to_string(),
                port: 443,
            }],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let target = PropagationRequestTarget::new(
        None,
        PropagationScheme::Https,
        "service.internal.example.com",
        None,
    );

    propagator
        .validate_target(&propagated_bearer_with_claims(), &target)
        .expect("target should use the default https port");
}

#[derive(Debug)]
struct StaticNodeTargetResolver;

impl crate::PropagationNodeTargetResolver for StaticNodeTargetResolver {
    fn resolve_url(&self, node_id: &str) -> Option<Url> {
        match node_id {
            "node-a" => Url::parse("https://service.internal.example.com").ok(),
            _ => None,
        }
    }
}

#[test]
fn token_propagator_rejects_node_only_target_without_resolver() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_node_ids: vec!["node-a".to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let error = propagator
        .validate_target(
            &propagated_bearer_with_claims(),
            &PropagationRequestTarget::for_node("node-a"),
        )
        .expect_err("node-only target should require a resolver");

    assert!(matches!(
        error,
        TokenPropagatorError::NodeTargetResolverRequired { .. }
    ));
}

#[test]
fn token_propagator_allows_node_only_target_with_resolver() {
    let propagator = TokenPropagator::from_config_with_node_target_resolver(
        &TokenPropagatorConfig {
            destination_policy: PropagationDestinationPolicy {
                allowed_node_ids: vec!["node-a".to_string()],
                allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                    scheme: PropagationScheme::Https,
                    hostname: "service.internal.example.com".to_string(),
                    port: 443,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        Some(Arc::new(StaticNodeTargetResolver)),
    )
    .expect("propagator should build");

    propagator
        .validate_target(
            &propagated_bearer_with_claims(),
            &PropagationRequestTarget::for_node("node-a"),
        )
        .expect("resolver should expand the node id into a valid target");
}

#[test]
fn token_propagator_set_node_target_resolver_updates_runtime_behavior() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_node_ids: vec!["node-a".to_string()],
            allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                scheme: PropagationScheme::Https,
                hostname: "service.internal.example.com".to_string(),
                port: 443,
            }],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let target = PropagationRequestTarget::for_node("node-a");

    let error = propagator
        .validate_target(&propagated_bearer_with_claims(), &target)
        .expect_err("node-only target should fail before the resolver is installed");
    assert!(matches!(
        error,
        TokenPropagatorError::NodeTargetResolverRequired { .. }
    ));

    propagator.set_node_target_resolver(Some(Arc::new(StaticNodeTargetResolver)));

    propagator
        .validate_target(&propagated_bearer_with_claims(), &target)
        .expect("resolver update should take effect immediately");
}

#[cfg(feature = "moka-pending-store")]
#[test]
fn mediated_context_wraps_token_propagator() {
    let context = MediatedContext::<MokaPendingAuthStateMetadataRedemptionStore>::from_config(
        MediatedContextConfig {
            token_propagation: TokenPropagatorConfig {
                destination_policy: PropagationDestinationPolicy {
                    allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                        scheme: PropagationScheme::Https,
                        hostname: "service.internal.example.com".to_string(),
                        port: 443,
                    }],
                    ..Default::default()
                },
                token_validation: PropagatedTokenValidationConfig {
                    required_issuers: vec!["https://issuer.example.com".to_string()],
                    allowed_audiences: vec!["mesh-api".to_string()],
                    required_scopes: vec!["mesh.forward".to_string()],
                    allowed_azp: vec!["securitydept-web".to_string()],
                },
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .expect("context should build");
    let target = PropagationRequestTarget::new(
        None,
        PropagationScheme::Https,
        "service.internal.example.com",
        443,
    );
    let mut headers = HeaderMap::new();

    context
        .apply_propagation_authorization_header(
            &propagated_bearer_with_claims(),
            &target,
            &mut headers,
        )
        .expect("propagation should succeed");

    assert_eq!(headers["authorization"], "Bearer access-token");
}

#[test]
fn token_propagator_allows_matching_domain_suffix() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_targets: vec![AllowedPropagationTarget::DomainSuffix {
                scheme: PropagationScheme::Https,
                domain_suffix: "mesh.internal.example.com".to_string(),
                port: 443,
            }],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let target = PropagationRequestTarget::new(
        None,
        PropagationScheme::Https,
        "api.mesh.internal.example.com",
        443,
    );

    propagator
        .validate_target(&propagated_bearer_with_claims(), &target)
        .expect("domain target should be allowed");
}

#[test]
fn token_propagator_allows_matching_domain_regex() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_targets: vec![AllowedPropagationTarget::DomainRegex {
                scheme: PropagationScheme::Https,
                domain_regex: Regex::new(r"^api-[a-z0-9-]+\.mesh\.internal\.example\.com$")
                    .expect("regex should compile"),
                port: 443,
            }],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let target = PropagationRequestTarget::new(
        None,
        PropagationScheme::Https,
        "api-orders.mesh.internal.example.com",
        443,
    );

    propagator
        .validate_target(&propagated_bearer_with_claims(), &target)
        .expect("regex target should be allowed");
}

#[test]
fn token_propagator_allows_matching_cidr_ip_literal() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_targets: vec![AllowedPropagationTarget::Cidr {
                scheme: PropagationScheme::Https,
                cidr: "10.0.0.0/24".to_string(),
                port: 8443,
            }],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let target = PropagationRequestTarget::new(None, PropagationScheme::Https, "10.0.0.42", 8443);

    propagator
        .validate_target(&propagated_bearer_with_claims(), &target)
        .expect("cidr target should be allowed");
}

#[test]
fn token_propagator_rejects_unlisted_target() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig::default())
        .expect("propagator should build");

    let error = propagator
        .validate_target(
            &propagated_bearer_with_claims(),
            &PropagationRequestTarget::new(
                None,
                PropagationScheme::Https,
                "api.mesh.internal.example.com",
                443,
            ),
        )
        .expect_err("target should be denied");

    assert!(matches!(
        error,
        TokenPropagatorError::DestinationNotAllowed { .. }
    ));
}

#[test]
fn token_propagator_rejects_missing_required_scope() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                scheme: PropagationScheme::Https,
                hostname: "service.internal.example.com".to_string(),
                port: 443,
            }],
            ..Default::default()
        },
        token_validation: PropagatedTokenValidationConfig {
            required_scopes: vec!["admin".to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");

    let error = propagator
        .validate_target(
            &propagated_bearer_with_claims(),
            &PropagationRequestTarget::new(
                None,
                PropagationScheme::Https,
                "service.internal.example.com",
                443,
            ),
        )
        .expect_err("scope should be rejected");

    assert!(matches!(
        error,
        TokenPropagatorError::TokenScopeMissing { .. }
    ));
}

#[test]
fn token_propagator_rejects_when_resource_token_principal_is_missing() {
    let propagator = TokenPropagator::from_config(&TokenPropagatorConfig {
        destination_policy: PropagationDestinationPolicy {
            allowed_targets: vec![AllowedPropagationTarget::ExactOrigin {
                scheme: PropagationScheme::Https,
                hostname: "service.internal.example.com".to_string(),
                port: 443,
            }],
            ..Default::default()
        },
        token_validation: PropagatedTokenValidationConfig {
            required_issuers: vec!["https://issuer.example.com".to_string()],
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("propagator should build");
    let error = propagator
        .validate_target(
            &PropagatedBearer {
                access_token: "access-token",
                resource_token_principal: None,
            },
            &PropagationRequestTarget::new(
                None,
                PropagationScheme::Https,
                "service.internal.example.com",
                443,
            ),
        )
        .expect_err("token facts should be required");

    assert!(matches!(error, TokenPropagatorError::TokenFactsUnavailable));
}

fn propagated_bearer_with_claims() -> PropagatedBearer<'static> {
    static ACCESS_TOKEN: &str = "access-token";
    let resource_token_principal = Box::leak(Box::new(ResourceTokenPrincipal {
        subject: Some("user-123".to_string()),
        issuer: Some("https://issuer.example.com".to_string()),
        audiences: vec!["mesh-api".to_string(), "profile".to_string()],
        scopes: vec![
            "openid".to_string(),
            "mesh.forward".to_string(),
            "profile".to_string(),
        ],
        authorized_party: Some("securitydept-web".to_string()),
        claims: [
            ("aud".to_string(), json!(["mesh-api", "profile"])),
            ("scope".to_string(), json!("openid mesh.forward profile")),
            ("azp".to_string(), json!("securitydept-web")),
        ]
        .into_iter()
        .collect(),
    }));

    PropagatedBearer {
        access_token: ACCESS_TOKEN,
        resource_token_principal: Some(resource_token_principal),
    }
}

#[cfg(feature = "moka-pending-store")]
#[test]
fn metadata_redemption_store_redeems_once() -> MediatedContextResult<()> {
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

#[cfg(feature = "moka-pending-store")]
#[test]
fn metadata_redemption_store_drops_expired_entries() -> MediatedContextResult<()> {
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
fn post_auth_redirect_uri_config_resolves_dynamic_allowed_redirect() {
    let post_auth_redirect_uri =
        TokenSetRedirectUriResolver::from_config(TokenSetRedirectUriConfig {
            default_redirect_target: Some("https://app.example.com/default".to_string()),
            dynamic_redirect_target_enabled: true,
            allowed_redirect_targets: vec![TokenSetRedirectUriRule::Regex {
                value: regex::Regex::new(r"^https://app\.example\.com/callback(/.*)?$")
                    .expect("regex should compile"),
            }],
        })
        .resolve_redirect_uri(Some("https://app.example.com/callback/tenant-a"))
        .expect("redirect should be allowed");

    assert_eq!(
        post_auth_redirect_uri.as_str(),
        "https://app.example.com/callback/tenant-a"
    );
}
