use std::{
    net::IpAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

use rcgen::{
    BasicConstraints, CertificateParams, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair,
    KeyUsagePurpose,
};
use securitydept_core::{
    oauth_provider::{OAuthProviderConfig, OAuthProviderRuntime},
    oauth_resource_server::{OAuthResourceServerConfig, OAuthResourceServerVerifier},
    oidc::{MokaPendingOauthStore, MokaPendingOauthStoreConfig, OidcClient, OidcClientConfig},
    realip::{
        CidrNodeRegistry, RealIpResolveConfig, RealIpResolver,
        config::{CustomCidrNodeConfig, NodeConfig},
        extension::{
            CidrNodeFactoryRegistry, CidrNodeLoadFuture, CustomCidrNodeFactory, DynamicCidrNode,
        },
    },
    token_set_context::{
        access_token_substrate::{
            AccessTokenSubstrateRuntime, ResolvedAccessTokenSubstrateConfig, TokenPropagation,
        },
        backend_oidc_mode::{
            BackendOidcModeRuntime, NeverMetadataRedemptionStore, ResolvedBackendOidcModeConfig,
        },
    },
};
use serde_json::json;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    task::{JoinHandle, JoinSet},
};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{self, RootCertStore, pki_types::PrivatePkcs8KeyDer},
};

const CLIENT_SECRET: &str = "test-client-secret-with-enough-entropy";

struct TestNode;
impl DynamicCidrNode for TestNode {
    fn load<'a>(&'a self) -> CidrNodeLoadFuture<'a> {
        Box::pin(async { Ok(vec!["198.51.100.1/32".parse().unwrap()]) })
    }
}
impl CustomCidrNodeFactory for TestNode {
    fn kind(&self) -> &'static str {
        "test-custom"
    }
    fn create(
        &self,
        _: &CustomCidrNodeConfig,
    ) -> securitydept_core::realip::RealIpResult<Arc<dyn DynamicCidrNode>> {
        Ok(Arc::new(TestNode))
    }
}

struct RemoveFileNode(std::path::PathBuf);

impl DynamicCidrNode for RemoveFileNode {
    fn load<'a>(&'a self) -> CidrNodeLoadFuture<'a> {
        Box::pin(async {
            std::fs::remove_file(&self.0).map_err(|source| {
                securitydept_core::realip::RealIpError::ReadCidrNodeFile {
                    path: self.0.clone(),
                    source,
                }
            })?;
            Ok(vec!["198.51.100.1/32".parse().unwrap()])
        })
    }
}

impl CustomCidrNodeFactory for RemoveFileNode {
    fn kind(&self) -> &'static str {
        "remove-file"
    }
    fn create(
        &self,
        _: &CustomCidrNodeConfig,
    ) -> securitydept_core::realip::RealIpResult<Arc<dyn DynamicCidrNode>> {
        Ok(Arc::new(Self(self.0.clone())))
    }
}

#[derive(Default)]
struct Requests {
    records: Mutex<Vec<(String, String)>>,
    connections: AtomicUsize,
    cidrs_failed: AtomicBool,
    cidrs_version: AtomicUsize,
}

struct TestServer {
    origin: String,
    ca: reqwest::Certificate,
    identity: reqwest::Identity,
    requests: Arc<Requests>,
    task: JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl TestServer {
    async fn start(mtls: bool) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let ca_key = KeyPair::generate().unwrap();
        let mut ca_params = CertificateParams::new(Vec::<String>::new()).unwrap();
        ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        ca_params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        let ca = ca_params.self_signed(&ca_key).unwrap();
        let issuer = Issuer::new(ca_params, &ca_key);
        let server_key = KeyPair::generate().unwrap();
        let mut server_params =
            CertificateParams::new(vec!["localhost".to_string(), "127.0.0.1".to_string()]).unwrap();
        server_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let server_cert = server_params.signed_by(&server_key, &issuer).unwrap();
        let client_key = KeyPair::generate().unwrap();
        let mut client_params = CertificateParams::new(Vec::<String>::new()).unwrap();
        client_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
        let client_cert = client_params.signed_by(&client_key, &issuer).unwrap();
        let identity = reqwest::Identity::from_pem(
            format!("{}{}", client_cert.pem(), client_key.serialize_pem()).as_bytes(),
        )
        .unwrap();
        let builder = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap();
        let builder = if mtls {
            let mut roots = RootCertStore::empty();
            roots.add(ca.der().clone()).unwrap();
            builder.with_client_cert_verifier(
                rustls::server::WebPkiClientVerifier::builder_with_provider(
                    Arc::new(roots),
                    Arc::new(rustls::crypto::ring::default_provider()),
                )
                .build()
                .unwrap(),
            )
        } else {
            builder.with_no_client_auth()
        };
        let mut tls = builder
            .with_single_cert(
                vec![server_cert.der().clone()],
                PrivatePkcs8KeyDer::from(server_key.serialize_der()).into(),
            )
            .unwrap();
        tls.alpn_protocols = vec![b"http/1.1".to_vec()];
        let acceptor = TlsAcceptor::from(Arc::new(tls));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!(
            "https://localhost:{}",
            listener.local_addr().unwrap().port()
        );
        let requests = Arc::new(Requests::default());
        let state = requests.clone();
        let server_origin = origin.clone();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        let (socket, _) = result.unwrap();
                        let acceptor = acceptor.clone();
                        let state = state.clone();
                        let origin = server_origin.clone();
                        connections.spawn(async move {
                            let Ok(stream) = acceptor.accept(socket).await else { return; };
                            state.connections.fetch_add(1, Ordering::SeqCst);
                            let mut stream = BufReader::new(stream);
                            loop {
                                let mut line = String::new();
                                if stream.read_line(&mut line).await.unwrap_or(0) == 0 { return; }
                                let path = line.split_whitespace().nth(1).unwrap_or_default().to_string();
                                let mut size = 0;
                                let mut marker = String::new();
                                loop {
                                    line.clear();
                                    if stream.read_line(&mut line).await.unwrap_or(0) == 0 { return; }
                                    if line == "\r\n" { break; }
                                    if let Some((name, value)) = line.split_once(':') {
                                        if name.eq_ignore_ascii_case("content-length") { size = value.trim().parse().unwrap(); }
                                        if name.eq_ignore_ascii_case("x-builder") { marker = value.trim().to_string(); }
                                    }
                                }
                                let mut body = vec![0; size];
                                if stream.read_exact(&mut body).await.is_err() { return; }
                                state.records.lock().unwrap().push((path.clone(), marker));
                                if path == "/slow" { tokio::time::sleep(Duration::from_millis(150)).await; }
                                let (status, extra, body) = match path.as_str() {
                                    "/discovery" => ("200 OK", "", json!({
                                        "issuer": origin, "authorization_endpoint": format!("{origin}/authorize"),
                                        "token_endpoint": format!("{origin}/token"), "jwks_uri": format!("{origin}/jwks"),
                                        "userinfo_endpoint": format!("{origin}/userinfo"), "introspection_endpoint": format!("{origin}/introspect"),
                                        "response_types_supported": ["code"], "subject_types_supported": ["public"],
                                        "id_token_signing_alg_values_supported": ["HS256"]
                                    }).to_string()),
                                    "/jwks" => ("200 OK", "", json!({"keys": []}).to_string()),
                                    "/token" => {
                                        let now = chrono::Utc::now().timestamp();
                                        let id_token = jsonwebtoken::encode(&jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
                                            &json!({"iss": origin, "aud": "test-client", "sub": "user", "iat": now, "exp": now + 3600, "nonce": "test-nonce"}),
                                            &jsonwebtoken::EncodingKey::from_secret(CLIENT_SECRET.as_bytes())).unwrap();
                                        ("200 OK", "", json!({"access_token": "access", "token_type": "Bearer", "id_token": id_token, "refresh_token": "refresh", "scope": "openid"}).to_string())
                                    }
                                    "/userinfo" => ("200 OK", "", json!({"sub": "user"}).to_string()),
                                    "/introspect" => ("200 OK", "", json!({"active": true, "sub": "user"}).to_string()),
                                    "/redirect" => ("307 Temporary Redirect", "Location: /leak\r\n", "{}".to_string()),
                                    "/cidrs" if state.cidrs_failed.load(Ordering::SeqCst) => ("503 Service Unavailable", "", "{}".to_string()),
                                    "/cidrs" => ("200 OK", "", format!("192.0.2.{}/32", state.cidrs_version.load(Ordering::SeqCst) + 1)),
                                    "/slow" => ("200 OK", "", "192.0.2.1/32".to_string()),
                                    _ => ("200 OK", "", "{}".to_string()),
                                };
                                let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\n\r\n{body}", body.len());
                                if stream.get_mut().write_all(response.as_bytes()).await.is_err() { return; }
                                if stream.get_mut().flush().await.is_err() { return; }
                            }
                        });
                    }
                    _ = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        });
        Self {
            origin,
            ca: reqwest::Certificate::from_der(ca.der()).unwrap(),
            identity,
            requests,
            task,
        }
    }

    fn builder(&self) -> reqwest::ClientBuilder {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-builder", "configured".parse().unwrap());
        reqwest::Client::builder()
            .no_proxy()
            .tls_certs_only([self.ca.clone()])
            .default_headers(headers)
    }

    fn provider_config(&self) -> OAuthProviderConfig {
        serde_json::from_value(json!({"well_known_url": format!("{}/discovery", self.origin)}))
            .unwrap()
    }

    fn oidc_config(&self) -> OidcClientConfig<MokaPendingOauthStoreConfig> {
        serde_json::from_value(json!({"well_known_url": format!("{}/discovery", self.origin), "client_id": "test-client", "client_secret": CLIENT_SECRET})).unwrap()
    }

    fn verifier_config(&self) -> OAuthResourceServerConfig {
        serde_json::from_value(json!({"well_known_url": format!("{}/discovery", self.origin), "audiences": ["test-client"]})).unwrap()
    }

    fn remote_node(&self, path: &str, timeout: Option<&str>, policy: &str) -> NodeConfig {
        serde_json::from_value(json!({"kind": "cidrs-remote-file", "name": policy, "urls": [format!("{}{path}", self.origin)], "refresh": "25ms", "timeout": timeout, "on_refresh_failure": policy})).unwrap()
    }
}

#[tokio::test]
async fn provider_ca_pool_oauth_and_redirect_policy() {
    let server = TestServer::start(false).await;
    assert!(
        OAuthProviderRuntime::from_config(server.provider_config())
            .await
            .is_err()
    );
    let provider = Arc::new(
        OAuthProviderRuntime::from_config_with_http_client_builder(
            server.provider_config(),
            server
                .builder()
                .redirect(reqwest::redirect::Policy::limited(5)),
        )
        .await
        .unwrap(),
    );
    provider.refresh_metadata().await.unwrap();
    provider.refresh_jwks().await.unwrap();
    provider
        .introspect("test-client", Some(CLIENT_SECRET), "opaque", None)
        .await
        .unwrap();
    let oidc =
        OidcClient::<MokaPendingOauthStore>::from_provider(provider.clone(), server.oidc_config())
            .await
            .unwrap();
    oidc.exchange_code(
        &url::Url::parse(&server.origin).unwrap(),
        "code",
        &openidconnect::Nonce::new("test-nonce".to_string()),
        None,
    )
    .await
    .unwrap();
    oidc.handle_token_refresh("refresh".to_string(), None)
        .await
        .unwrap();
    let response = provider
        .http_client()
        .get(format!("{}/redirect", server.origin))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 307);
    let mut config = server.oidc_config();
    config.provider_oidc.token_endpoint = Some(format!("{}/redirect", server.origin));
    assert_eq!(server.requests.connections.load(Ordering::SeqCst), 1);
    let redirect_oidc = OidcClient::<MokaPendingOauthStore>::from_config_with_http_client_builder(
        config,
        server
            .builder()
            .redirect(reqwest::redirect::Policy::limited(5)),
    )
    .await
    .unwrap();
    assert!(
        redirect_oidc
            .exchange_code(
                &url::Url::parse(&server.origin).unwrap(),
                "code",
                &openidconnect::Nonce::new("test-nonce".to_string()),
                None
            )
            .await
            .is_err()
    );
    let records = server.requests.records.lock().unwrap();
    assert!(records.iter().all(|(_, marker)| marker == "configured"));
    for path in ["/discovery", "/jwks", "/token", "/introspect", "/userinfo"] {
        assert!(records.iter().any(|(p, _)| p == path));
    }
    assert!(!records.iter().any(|(path, _)| path == "/leak"));
    assert_eq!(server.requests.connections.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn mtls_and_all_oauth_creation_layers() {
    let server = TestServer::start(true).await;
    assert!(
        OAuthProviderRuntime::from_config_with_http_client_builder(
            server.provider_config(),
            server.builder()
        )
        .await
        .is_err()
    );
    let builder = || server.builder().identity(server.identity.clone());
    let client = OidcClient::<MokaPendingOauthStore>::from_config_with_http_client_builder(
        server.oidc_config(),
        builder(),
    )
    .await
    .unwrap();
    client.provider().refresh_jwks().await.unwrap();
    let verifier = OAuthResourceServerVerifier::from_config_with_http_client_builder(
        server.verifier_config(),
        builder(),
    )
    .await
    .unwrap();
    verifier.metadata().await.unwrap();
    let resolved = ResolvedBackendOidcModeConfig {
        oidc_client: server.oidc_config(),
        runtime: Default::default(),
    };
    let (_, client) = BackendOidcModeRuntime::<NeverMetadataRedemptionStore>::from_resolved_config_with_http_client_builder::<MokaPendingOauthStore>(Some(&resolved), builder()).await.unwrap();
    client.unwrap().provider().refresh_metadata().await.unwrap();
    let substrate = ResolvedAccessTokenSubstrateConfig {
        resource_server: server.verifier_config(),
        token_propagation: TokenPropagation::Disabled,
    };
    let (_, verifier) = AccessTokenSubstrateRuntime::from_resolved_config_with_http_client_builder(
        &substrate,
        builder(),
    )
    .await
    .unwrap();
    verifier.unwrap().metadata().await.unwrap();
    let node = server.remote_node("/cidrs", None, "clear");
    let registry = CidrNodeRegistry::from_configs_with_http_client_builder(&[node], builder())
        .await
        .unwrap();
    assert!(registry.contains("clear", "192.0.2.1".parse().unwrap()));
    assert!(
        server
            .requests
            .records
            .lock()
            .unwrap()
            .iter()
            .all(|(_, marker)| marker == "configured")
    );
}

#[tokio::test]
async fn remote_nodes_refresh_with_injected_client_and_failure_policies() {
    let server = TestServer::start(false).await;
    let mut factories = CidrNodeFactoryRegistry::new();
    factories.register(TestNode).unwrap();
    let custom: NodeConfig =
        serde_json::from_value(json!({"kind": "test-custom", "name": "custom"})).unwrap();
    let nodes = [
        server.remote_node("/cidrs", None, "keep-last-good"),
        server.remote_node("/cidrs", None, "clear"),
        custom,
    ];
    let registry = CidrNodeRegistry::from_configs_with_factories_and_http_client_builder(
        &nodes,
        &factories,
        server.builder(),
    )
    .await
    .unwrap();
    assert!(registry.contains("custom", "198.51.100.1".parse().unwrap()));
    server.requests.cidrs_version.store(1, Ordering::SeqCst);
    let ip: IpAddr = "192.0.2.2".parse().unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while !registry.contains("keep-last-good", ip) || !registry.contains("clear", ip) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    server.requests.cidrs_failed.store(true, Ordering::SeqCst);
    tokio::time::timeout(Duration::from_secs(3), async {
        while registry.snapshot("clear").is_some() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(registry.contains("keep-last-good", ip));
    assert!(
        server
            .requests
            .records
            .lock()
            .unwrap()
            .iter()
            .all(|(_, marker)| marker == "configured")
    );
}

#[tokio::test]
async fn remote_timeout_and_resolver_creation_variants() {
    let server = TestServer::start(false).await;
    let node = server.remote_node("/slow", None, "clear");
    assert!(
        CidrNodeRegistry::from_configs_with_http_client_builder(
            &[node],
            server.builder().timeout(Duration::from_millis(20))
        )
        .await
        .is_err()
    );
    let node = server.remote_node("/slow", Some("20ms"), "clear");
    assert!(
        CidrNodeRegistry::from_configs_with_http_client_builder(
            &[node],
            server.builder().timeout(Duration::from_secs(2))
        )
        .await
        .is_err()
    );
    let node = server.remote_node("/slow", Some("2s"), "clear");
    let registry = CidrNodeRegistry::from_configs_with_http_client_builder(
        std::slice::from_ref(&node),
        server.builder().timeout(Duration::from_millis(20)),
    )
    .await
    .unwrap();
    assert!(registry.contains("clear", "192.0.2.1".parse().unwrap()));
    let config = RealIpResolveConfig {
        nodes: vec![node],
        ..Default::default()
    };
    let _resolver =
        RealIpResolver::from_config_with_http_client_builder(config.clone(), server.builder())
            .await
            .unwrap();
    let _resolver = RealIpResolver::from_config_with_factories_and_http_client_builder(
        config,
        &CidrNodeFactoryRegistry::new(),
        server.builder(),
    )
    .await
    .unwrap();
}

fn invalid_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().user_agent("invalid\nheader")
}

#[tokio::test]
async fn unused_builders_are_not_built_and_invalid_config_wins() {
    let (_, client) = BackendOidcModeRuntime::<NeverMetadataRedemptionStore>::from_resolved_config_with_http_client_builder::<MokaPendingOauthStore>(None, invalid_builder()).await.unwrap();
    assert!(client.is_none());
    let substrate = ResolvedAccessTokenSubstrateConfig {
        resource_server: Default::default(),
        token_propagation: TokenPropagation::Disabled,
    };
    let (_, verifier) = AccessTokenSubstrateRuntime::from_resolved_config_with_http_client_builder(
        &substrate,
        invalid_builder(),
    )
    .await
    .unwrap();
    assert!(verifier.is_none());
    let inline: NodeConfig = serde_json::from_value(
        json!({"kind": "cidrs-inline", "name": "local", "cidrs": ["192.0.2.1/32"]}),
    )
    .unwrap();
    CidrNodeRegistry::from_configs_with_http_client_builder(&[inline], invalid_builder())
        .await
        .unwrap();
    RealIpResolver::from_config_with_http_client_builder(Default::default(), invalid_builder())
        .await
        .unwrap();
    let error = OAuthProviderRuntime::from_config_with_http_client_builder(
        Default::default(),
        invalid_builder(),
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(
        error,
        securitydept_core::oauth_provider::OAuthProviderError::InvalidConfig { .. }
    ));
}

#[tokio::test]
async fn build_errors_are_reported_before_any_network_request() {
    let server = TestServer::start(false).await;
    let error = OAuthProviderRuntime::from_config_with_http_client_builder(
        server.provider_config(),
        invalid_builder(),
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(
        error,
        securitydept_core::oauth_provider::OAuthProviderError::HttpClient { .. }
    ));
    let node = server.remote_node("/cidrs", None, "clear");
    assert!(matches!(
        CidrNodeRegistry::from_configs_with_http_client_builder(&[node], invalid_builder()).await,
        Err(securitydept_core::realip::RealIpError::CidrNodeHttp { .. })
    ));
    let invalid: NodeConfig =
        serde_json::from_value(json!({"kind": "cidrs-remote-file", "name": "invalid", "urls": []}))
            .unwrap();
    assert!(matches!(
        CidrNodeRegistry::from_configs_with_http_client_builder(&[invalid], invalid_builder())
            .await,
        Err(securitydept_core::realip::RealIpError::Config { .. })
    ));
    assert!(server.requests.records.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_watcher_initialization_aborts_already_started_refresh_tasks() {
    let server = TestServer::start(false).await;
    let port = url::Url::parse(&server.origin).unwrap().port().unwrap();
    let path = std::env::temp_dir().join(format!(
        "securitydept-builder-watch-{}-{port}",
        std::process::id()
    ));
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .unwrap();
    std::io::Write::write_all(&mut file, b"198.51.100.1/32").unwrap();
    drop(file);
    let mut factories = CidrNodeFactoryRegistry::new();
    factories.register(RemoveFileNode(path.clone())).unwrap();
    let local: NodeConfig = serde_json::from_value(json!({
        "kind": "cidrs-local-file", "name": "local", "path": path, "watch": true
    }))
    .unwrap();
    let remove: NodeConfig =
        serde_json::from_value(json!({"kind": "remove-file", "name": "remove"})).unwrap();
    // The local file loads successfully, then the custom node removes it before
    // watcher creation, after the remote refresh task has already been spawned.
    let nodes = [server.remote_node("/cidrs", None, "clear"), local, remove];
    let result = CidrNodeRegistry::from_configs_with_factories_and_http_client_builder(
        &nodes,
        &factories,
        server.builder(),
    )
    .await;
    assert!(matches!(
        result,
        Err(securitydept_core::realip::RealIpError::WatchCidrNode { .. })
    ));
    tokio::time::sleep(Duration::from_millis(75)).await;
    let count = server.requests.records.lock().unwrap().len();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(server.requests.records.lock().unwrap().len(), count);
}
