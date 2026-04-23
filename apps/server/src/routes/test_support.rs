use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::to_bytes,
    http::{StatusCode, header},
    response::Response,
};
use securitydept_core::{
    basic_auth_context::BasicAuthContext,
    creds::Argon2BasicAuthCred,
    creds_manage::{models::DataFile, store::CredsManageStore},
    token_set_context::{
        access_token_substrate::{AccessTokenSubstrateRuntime, TokenPropagation},
        backend_oidc_mode::{BackendOidcModeRuntime, MokaPendingAuthStateMetadataRedemptionStore},
    },
};
use serde_json::Value;

use crate::{config::ServerConfig, state::ServerState};

pub async fn test_server_state(label: &str) -> ServerState {
    test_server_state_with_data(label, None).await
}

pub async fn test_server_state_with_data(
    label: &str,
    initial_data: Option<DataFile>,
) -> ServerState {
    let config_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("config.example.toml");
    let mut config = ServerConfig::load(&config_path).expect("test config should load");
    config.server.webui_dir = None;
    let config = Arc::new(config);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let store_path = std::env::temp_dir().join(format!(
        "securitydept-server-route-test-{label}-{nanos}.json"
    ));
    if let Some(initial_data) = initial_data {
        let bytes = serde_json::to_vec(&initial_data).expect("initial data file should serialize");
        std::fs::write(&store_path, bytes).expect("initial data file should be written");
    }
    let creds_manage_store = Arc::new(
        CredsManageStore::load(&store_path)
            .await
            .expect("test creds-manage store should load"),
    );
    let backend_oidc_runtime = Arc::new(
        BackendOidcModeRuntime::<MokaPendingAuthStateMetadataRedemptionStore>::from_config(
            Default::default(),
        )
        .expect("default backend-oidc runtime should build"),
    );
    let substrate_runtime = AccessTokenSubstrateRuntime::new(&TokenPropagation::Disabled)
        .expect("disabled substrate runtime should build");
    let basic_auth_context = Arc::new(
        BasicAuthContext::<Argon2BasicAuthCred>::from_config(config.basic_auth_context.clone())
            .expect("default basic-auth context should build"),
    );

    ServerState {
        config,
        creds_manage_store,
        backend_oidc_runtime,
        frontend_oidc_runtime: None,
        substrate_runtime,
        basic_auth_context,
        real_ip_resolver: None,
        oidc_client: None,
        oauth_resource_server_verifier: None,
        propagation_forwarder: None,
    }
}

pub async fn assert_server_error_envelope(
    response: Response,
    expected_status: StatusCode,
    expected_kind: &str,
    expected_code: &str,
    expected_recovery: &str,
) {
    assert_eq!(response.status(), expected_status);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .expect("error envelope should set content type"),
        "application/json"
    );

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    let envelope: Value = serde_json::from_slice(&body).expect("response should be valid json");

    assert_eq!(envelope["success"], false);
    assert_eq!(envelope["status"], expected_status.as_u16());
    assert_eq!(envelope["error"]["kind"], expected_kind);
    assert_eq!(envelope["error"]["code"], expected_code);
    assert_eq!(envelope["error"]["recovery"], expected_recovery);
    assert_eq!(envelope["error"]["presentation"]["code"], expected_code);
    assert_eq!(
        envelope["error"]["presentation"]["recovery"],
        expected_recovery
    );
}
