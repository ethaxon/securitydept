#![cfg(feature = "config-schema")]

use securitydept_oidc_client::PendingOauthStoreConfig;
use securitydept_token_set_context::{
    access_token_substrate::AllowedPropagationTarget,
    backend_oidc_mode::{BackendOidcModeConfig, PendingAuthStateMetadataRedemptionConfig},
    cross_mode_config::TokenSetOidcSharedIntersectionConfig,
    frontend_oidc_mode::FrontendOidcModeConfigProjection,
};
use serde::Deserialize;

fn render_schema<T: schemars::JsonSchema>() -> String {
    serde_json::to_string(&schemars::schema_for!(T)).expect("schema should serialize")
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize, schemars::JsonSchema)]
struct TestPendingStoreConfig {
    label: Option<String>,
}

impl PendingOauthStoreConfig for TestPendingStoreConfig {}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize, schemars::JsonSchema)]
struct TestMetadataConfig {
    redemption_audience: Option<String>,
}

impl PendingAuthStateMetadataRedemptionConfig for TestMetadataConfig {}

#[test]
fn shared_intersection_schema_uses_input_field_names_and_list_shapes() {
    let rendered = render_schema::<TokenSetOidcSharedIntersectionConfig>();

    assert!(rendered.contains("\"client_id\""));
    assert!(rendered.contains("\"scopes\""));
    assert!(rendered.contains("\"required_scopes\""));
    assert!(rendered.contains("\"device_poll_interval\""));
    assert!(!rendered.contains("\"clientId\""));
    assert!(rendered.contains("\"type\":\"array\""));
    assert!(rendered.contains("\"type\":\"string\""));
}

#[test]
fn frontend_projection_schema_uses_camel_case_field_names() {
    let rendered = render_schema::<FrontendOidcModeConfigProjection>();

    assert!(rendered.contains("\"wellKnownUrl\""));
    assert!(rendered.contains("\"metadataRefreshInterval\""));
    assert!(rendered.contains("\"requiredScopes\""));
    assert!(!rendered.contains("\"well_known_url\""));
}

#[test]
fn backend_config_schema_carries_tagged_runtime_axes_and_generic_configs() {
    let rendered =
        render_schema::<BackendOidcModeConfig<TestPendingStoreConfig, TestMetadataConfig>>();

    assert!(rendered.contains("\"refresh_material_protection\""));
    assert!(rendered.contains("\"metadata_delivery\""));
    assert!(rendered.contains("\"post_auth_redirect\""));
    assert!(rendered.contains("\"kind\""));
    assert!(rendered.contains("\"master_key\""));
    assert!(rendered.contains("\"label\""));
    assert!(rendered.contains("\"redemption_audience\""));
}

#[test]
fn allowed_propagation_target_schema_uses_string_regex_field() {
    let rendered = render_schema::<AllowedPropagationTarget>();

    assert!(rendered.contains("\"domain_regex\""));
    assert!(rendered.contains("\"type\":\"string\""));
}

#[cfg(feature = "moka-pending-store")]
#[test]
fn moka_metadata_redemption_schema_uses_string_ttl() {
    let rendered = render_schema::<
        securitydept_token_set_context::backend_oidc_mode::MokaPendingAuthStateMetadataRedemptionConfig,
    >();

    assert!(rendered.contains("\"ttl\""));
    assert!(rendered.contains("\"max_capacity\""));
    assert!(rendered.contains("\"type\":\"string\""));
}
