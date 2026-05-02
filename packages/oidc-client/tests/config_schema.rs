#![cfg(all(feature = "config-schema", feature = "moka-pending-store"))]

use securitydept_oidc_client::{MokaPendingOauthStoreConfig, OidcClientRawConfig};

fn render_schema<T: schemars::JsonSchema>() -> String {
    serde_json::to_string(&schemars::schema_for!(T)).expect("schema should serialize")
}

#[test]
fn oidc_client_raw_schema_includes_moka_pending_store_shape() {
    let rendered = render_schema::<OidcClientRawConfig<MokaPendingOauthStoreConfig>>();

    assert!(rendered.contains("\"pending_store\""));
    assert!(rendered.contains("\"ttl\""));
    assert!(rendered.contains("\"max_capacity\""));
    assert!(rendered.contains("\"type\":\"string\""));
}
