use std::{collections::BTreeMap, net::IpAddr, str::FromStr, sync::Arc, time::Duration};

use ipnet::IpNet;
use securitydept_realip::{
    CidrNodeRegistry,
    config::{
        CidrsCommandNodeConfig, CidrsInlineNodeConfig, CidrsLocalFileNodeConfig,
        CidrsRemoteFileNodeConfig, CoreNodeConfig, NodeConfig, RefreshFailurePolicy,
    },
    extension::{
        CidrNodeFactoryRegistry, CidrNodeLoadFuture, CustomCidrNodeFactory, DynamicCidrNode,
    },
};

#[tokio::test]
async fn inline_cidr_node_loads_addresses() -> anyhow::Result<()> {
    let config = NodeConfig::Core(CoreNodeConfig::CidrsInline(CidrsInlineNodeConfig {
        name: "inline-test".to_string(),
        priority: 0,
        accepts_from: vec![],
        allow_multiple_unions: false,
        cidrs: vec![
            IpNet::from_str("192.168.1.0/24")?,
            IpNet::from(IpAddr::from_str("10.0.0.1")?),
        ],
        extra: BTreeMap::new(),
    }));

    let registry = CidrNodeRegistry::from_configs(&[config]).await?;
    let mut cidrs = registry
        .snapshot("inline-test")
        .unwrap()
        .cidrs
        .as_ref()
        .clone();
    cidrs.sort();

    assert_eq!(
        cidrs,
        vec![
            IpNet::from_str("10.0.0.1/32")?,
            IpNet::from_str("192.168.1.0/24")?,
        ]
    );
    Ok(())
}

#[tokio::test]
async fn local_file_cidr_node_loads_addresses() -> anyhow::Result<()> {
    let file_path = std::env::temp_dir().join(format!("realip-test-local-{}", std::process::id()));
    std::fs::write(
        &file_path,
        "172.16.0.0/12\n10.10.10.10\n# comment\n1.1.1.1, 8.8.8.8  9.9.9.9\n",
    )?;

    let config = NodeConfig::Core(CoreNodeConfig::CidrsLocalFile(CidrsLocalFileNodeConfig {
        name: "local-file-test".to_string(),
        priority: 0,
        accepts_from: vec![],
        allow_multiple_unions: false,
        path: file_path.clone(),
        watch: false,
        debounce: None,
        max_stale: None,
        extra: BTreeMap::new(),
    }));

    let registry = CidrNodeRegistry::from_configs(&[config]).await?;
    std::fs::remove_file(&file_path).ok();
    let mut cidrs = registry
        .snapshot("local-file-test")
        .unwrap()
        .cidrs
        .as_ref()
        .clone();
    cidrs.sort();

    assert_eq!(cidrs.len(), 5);
    assert_eq!(cidrs[0], IpNet::from_str("1.1.1.1/32")?);
    assert_eq!(cidrs[4], IpNet::from_str("172.16.0.0/12")?);
    Ok(())
}

#[tokio::test]
async fn command_cidr_node_loads_addresses() -> anyhow::Result<()> {
    let config = NodeConfig::Core(CoreNodeConfig::CidrsCommand(CidrsCommandNodeConfig {
        name: "command-test".to_string(),
        priority: 0,
        accepts_from: vec![],
        allow_multiple_unions: false,
        command: "sh".to_string(),
        args: vec!["-c".to_string(), "echo '2.2.2.2/32\n3.3.3.3'".to_string()],
        refresh: None,
        timeout: Some(Duration::from_secs(5)),
        on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
        max_stale: None,
        extra: BTreeMap::new(),
    }));

    let registry = CidrNodeRegistry::from_configs(&[config]).await?;
    let mut cidrs = registry
        .snapshot("command-test")
        .unwrap()
        .cidrs
        .as_ref()
        .clone();
    cidrs.sort();
    assert_eq!(
        cidrs,
        vec![
            IpNet::from_str("2.2.2.2/32")?,
            IpNet::from_str("3.3.3.3/32")?,
        ]
    );
    Ok(())
}

#[tokio::test]
async fn remote_file_cidr_node_unions_all_urls() -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut request = [0_u8; 1024];
            let count = tokio::io::AsyncReadExt::read(&mut socket, &mut request)
                .await
                .unwrap_or_default();
            let request = String::from_utf8_lossy(&request[..count]);
            let body = if request.contains("GET /v4") {
                "4.4.4.4\n"
            } else {
                "2001:db8::/32\n"
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body,
            );
            let _ = tokio::io::AsyncWriteExt::write_all(&mut socket, response.as_bytes()).await;
        }
    });

    let config = NodeConfig::Core(CoreNodeConfig::CidrsRemoteFile(CidrsRemoteFileNodeConfig {
        name: "remote-file-test".to_string(),
        priority: 0,
        accepts_from: vec![],
        allow_multiple_unions: false,
        urls: vec![
            format!("http://127.0.0.1:{port}/v4"),
            format!("http://127.0.0.1:{port}/v6"),
        ],
        refresh: None,
        timeout: Some(Duration::from_secs(5)),
        on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
        max_stale: None,
        extra: BTreeMap::new(),
    }));

    let registry = CidrNodeRegistry::from_configs(&[config]).await?;
    let cidrs = registry.snapshot("remote-file-test").unwrap().cidrs.clone();
    assert_eq!(cidrs.len(), 2);
    assert!(cidrs.contains(&IpNet::from_str("4.4.4.4/32")?));
    assert!(cidrs.contains(&IpNet::from_str("2001:db8::/32")?));
    Ok(())
}

#[tokio::test]
async fn stale_cidr_node_stops_matching() -> anyhow::Result<()> {
    let config = NodeConfig::Core(CoreNodeConfig::CidrsCommand(CidrsCommandNodeConfig {
        name: "stale-test".to_string(),
        priority: 0,
        accepts_from: vec![],
        allow_multiple_unions: false,
        command: "sh".to_string(),
        args: vec!["-c".to_string(), "echo 10.0.0.0/8".to_string()],
        refresh: None,
        timeout: None,
        on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
        max_stale: Some(Duration::ZERO),
        extra: BTreeMap::new(),
    }));

    let registry = CidrNodeRegistry::from_configs(&[config]).await?;
    assert!(registry.snapshot("stale-test").is_none());
    Ok(())
}

struct StaticCidrNode;

impl DynamicCidrNode for StaticCidrNode {
    fn load<'a>(&'a self) -> CidrNodeLoadFuture<'a> {
        Box::pin(async { Ok(vec!["10.10.0.0/16".parse().unwrap()]) })
    }
}

struct StaticCidrNodeFactory;

impl CustomCidrNodeFactory for StaticCidrNodeFactory {
    fn kind(&self) -> &'static str {
        "static-custom"
    }

    fn create(
        &self,
        _config: &securitydept_realip::config::CustomCidrNodeConfig,
    ) -> securitydept_realip::RealIpResult<Arc<dyn DynamicCidrNode>> {
        Ok(Arc::new(StaticCidrNode))
    }
}

#[tokio::test]
async fn custom_cidr_node_factory_remains_extensible() -> anyhow::Result<()> {
    let node: NodeConfig = serde_json::from_value(serde_json::json!({
        "name": "custom",
        "kind": "static-custom"
    }))?;
    let mut factories = CidrNodeFactoryRegistry::new();
    factories.register(StaticCidrNodeFactory)?;

    let registry = CidrNodeRegistry::from_configs_with_factories(&[node], &factories).await?;
    assert!(registry.contains("custom", "10.10.2.3".parse()?));
    Ok(())
}
