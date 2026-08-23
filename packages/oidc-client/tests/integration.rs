use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    Form, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use openidconnect::{Nonce, TokenIntrospectionResponse};
use securitydept_oidc_client::{
    MokaPendingOauthStore, MokaPendingOauthStoreConfig, OAuthProviderRuntime, OidcClient,
    OidcClientConfig, OidcDeviceTokenPollResult,
};
use serde_json::{Value, json};
use tokio::{net::TcpListener, task::JoinHandle};
use url::Url;

const CLIENT_ID: &str = "test-client";
const CLIENT_SECRET: &str = "test-client-secret-with-enough-entropy";

struct RecordedRequest {
    path: &'static str,
    headers: HeaderMap,
    params: HashMap<String, String>,
}

#[derive(Clone)]
struct ProviderState {
    origin: String,
    id_token: String,
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
}

impl ProviderState {
    fn record(&self, path: &'static str, headers: HeaderMap, params: HashMap<String, String>) {
        self.requests.lock().unwrap().push(RecordedRequest {
            path,
            headers,
            params,
        });
    }
}

struct TestProvider {
    state: ProviderState,
    task: JoinHandle<()>,
}

impl Drop for TestProvider {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl TestProvider {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let now = chrono::Utc::now().timestamp();
        let id_token = encode(
            &Header::new(Algorithm::HS256),
            &json!({
                "iss": origin, "aud": CLIENT_ID, "sub": "test-user",
                "iat": now, "exp": now + 3600, "nonce": "test-nonce",
            }),
            &EncodingKey::from_secret(CLIENT_SECRET.as_bytes()),
        )
        .unwrap();
        let state = ProviderState {
            origin,
            id_token,
            requests: Arc::default(),
        };
        let router = Router::new()
            .route("/discovery", get(discovery))
            .route("/jwks", get(|| async { Json(json!({ "keys": [] })) }))
            .route("/introspect", post(introspect))
            .route("/token", post(token))
            .route("/userinfo", get(userinfo))
            .route("/device", post(device))
            .route(
                "/redirect-jwks",
                get(|| async { Redirect::temporary("/jwks") }),
            )
            .route(
                "/redirect-token",
                post(|| async { Redirect::temporary("/token") }),
            )
            .with_state(state.clone());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self { state, task }
    }

    fn config(&self) -> OidcClientConfig<MokaPendingOauthStoreConfig> {
        serde_json::from_value(json!({
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "well_known_url": format!("{}/discovery", self.state.origin),
            "metadata_refresh_interval": "0s",
            "jwks_refresh_interval": "0s",
            "required_scopes": ["openid"],
        }))
        .unwrap()
    }
}

async fn discovery(State(state): State<ProviderState>) -> Json<Value> {
    let origin = &state.origin;
    Json(json!({
        "issuer": origin,
        "authorization_endpoint": format!("{origin}/authorize"),
        "token_endpoint": format!("{origin}/token"),
        "userinfo_endpoint": format!("{origin}/userinfo"),
        "introspection_endpoint": format!("{origin}/introspect"),
        "device_authorization_endpoint": format!("{origin}/device"),
        "jwks_uri": format!("{origin}/jwks"),
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["HS256"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic"],
    }))
}

async fn introspect(
    State(state): State<ProviderState>,
    headers: HeaderMap,
    Form(params): Form<HashMap<String, String>>,
) -> Json<Value> {
    state.record("introspect", headers, params);
    Json(json!({ "active": true, "sub": "test-user", "scope": "openid" }))
}

async fn token(
    State(state): State<ProviderState>,
    headers: HeaderMap,
    Form(params): Form<HashMap<String, String>>,
) -> Response {
    let device_poll = params
        .get("grant_type")
        .is_some_and(|grant| grant == "urn:ietf:params:oauth:grant-type:device_code");
    state.record("token", headers, params);
    if device_poll {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "authorization_pending" })),
        )
            .into_response();
    }
    Json(json!({
        "access_token": "test-access-token", "token_type": "Bearer", "expires_in": 3600,
        "refresh_token": "test-refresh-token", "scope": "openid", "id_token": state.id_token,
    }))
    .into_response()
}

async fn userinfo(State(state): State<ProviderState>, headers: HeaderMap) -> Json<Value> {
    state.record("userinfo", headers, HashMap::new());
    Json(json!({ "sub": "test-user", "name": "Test User" }))
}

async fn device(
    State(state): State<ProviderState>,
    headers: HeaderMap,
    Form(params): Form<HashMap<String, String>>,
) -> Json<Value> {
    state.record("device", headers, params);
    Json(json!({
        "device_code": "test-device-code", "user_code": "TEST-CODE",
        "verification_uri": format!("{}/verify", state.origin), "expires_in": 600, "interval": 5,
    }))
}

#[tokio::test]
async fn provider_and_oidc_flows_use_the_reqwest_adapter() {
    let server = TestProvider::start().await;
    let client = OidcClient::<MokaPendingOauthStore>::from_config(server.config())
        .await
        .unwrap();
    let provider = client.provider();

    provider.refresh_metadata().await.unwrap();
    provider.refresh_jwks().await.unwrap();
    let introspection = provider
        .introspect(
            CLIENT_ID,
            Some(CLIENT_SECRET),
            "test-access-token",
            Some("access_token"),
        )
        .await
        .unwrap();
    assert!(introspection.active());

    let exchanged = client
        .exchange_code(
            &Url::parse("http://app.example.com").unwrap(),
            "test-code",
            &Nonce::new("test-nonce".to_string()),
            Some("test-pkce-verifier"),
        )
        .await
        .unwrap();
    assert_eq!(exchanged.access_token, "test-access-token");
    assert_eq!(
        exchanged.user_info_claims.unwrap().subject().as_str(),
        "test-user"
    );

    let refreshed = client
        .handle_token_refresh("test-refresh-token".to_string(), None)
        .await
        .unwrap();
    assert_eq!(refreshed.access_token, "test-access-token");
    assert_eq!(
        refreshed.user_info_claims.unwrap().subject().as_str(),
        "test-user"
    );

    let authorization = client.handle_device_authorize().await.unwrap();
    assert_eq!(authorization.device_code, "test-device-code");
    assert!(matches!(
        client
            .handle_device_token_poll(&authorization, None)
            .await
            .unwrap(),
        OidcDeviceTokenPollResult::Pending { .. }
    ));

    let requests = server.state.requests.lock().unwrap();
    let introspection = requests
        .iter()
        .find(|request| request.path == "introspect")
        .unwrap();
    assert_eq!(introspection.params["token"], "test-access-token");
    assert_eq!(introspection.params["token_type_hint"], "access_token");
    let code = requests
        .iter()
        .find(|request| {
            request
                .params
                .get("grant_type")
                .is_some_and(|grant| grant == "authorization_code")
        })
        .unwrap();
    assert_eq!(code.params["code_verifier"], "test-pkce-verifier");
    assert!(
        code.headers["authorization"]
            .to_str()
            .unwrap()
            .starts_with("Basic ")
    );
    let poll = requests
        .iter()
        .find(|request| request.params.contains_key("device_code"))
        .unwrap();
    assert_eq!(poll.params["device_code"], "test-device-code");
    assert_eq!(poll.headers["authorization"], code.headers["authorization"]);
    assert!(
        requests
            .iter()
            .filter(|request| request.path == "userinfo")
            .all(|request| request.headers["authorization"] == "Bearer test-access-token")
    );
}

#[tokio::test]
async fn provider_does_not_follow_jwks_or_token_redirects() {
    let server = TestProvider::start().await;
    let mut config = server.config();
    config.remote.jwks_uri = Some(format!("{}/redirect-jwks", server.state.origin));
    assert!(
        OAuthProviderRuntime::from_config(config.provider_config())
            .await
            .is_err()
    );

    let mut config = server.config();
    config.provider_oidc.token_endpoint = Some(format!("{}/redirect-token", server.state.origin));
    let client = OidcClient::<MokaPendingOauthStore>::from_config(config)
        .await
        .unwrap();
    assert!(
        client
            .handle_token_refresh("test-refresh-token".to_string(), None)
            .await
            .is_err()
    );
    assert!(server.state.requests.lock().unwrap().is_empty());
}
