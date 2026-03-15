use std::{collections::BTreeMap, net::IpAddr, str::FromStr, time::Duration};

use ipnet::IpNet;
use securitydept_realip::{
    ProviderRegistry,
    config::{
        CommandProviderConfig, CoreProviderConfig, InlineProviderConfig, LocalFileProviderConfig,
        ProviderConfig, RemoteFileProviderConfig, RefreshFailurePolicy,
    },
};

#[tokio::test]
async fn test_inline_provider() -> anyhow::Result<()> {
    let config = ProviderConfig::Core(CoreProviderConfig::Inline(InlineProviderConfig {
        name: "inline-test".to_string(),
        cidrs: vec![
            IpNet::from_str("192.168.1.0/24")?,
            IpNet::from(IpAddr::from_str("10.0.0.1")?),
        ],
        extra: BTreeMap::new(),
    }));

    let registry = ProviderRegistry::from_configs(&[config]).await?;
    let mut cidrs = registry.all_cidrs().await;
    cidrs.sort();

    assert_eq!(cidrs.len(), 2);
    assert_eq!(cidrs[0], IpNet::from_str("10.0.0.1/32")?);
    assert_eq!(cidrs[1], IpNet::from_str("192.168.1.0/24")?);

    Ok(())
}

#[tokio::test]
async fn test_local_file_provider() -> anyhow::Result<()> {
    let tmp_dir = std::env::temp_dir();
    let file_path = tmp_dir.join(format!("realip-test-local-{}", std::process::id()));

    std::fs::write(&file_path, "172.16.0.0/12\n10.10.10.10\n# comment\n1.1.1.1, 8.8.8.8  9.9.9.9\n")?;

    let config = ProviderConfig::Core(CoreProviderConfig::LocalFile(LocalFileProviderConfig {
        name: "local-file-test".to_string(),
        path: file_path.clone(),
        watch: false,
        debounce: None,
        max_stale: None,
        extra: BTreeMap::new(),
    }));

    let registry = ProviderRegistry::from_configs(&[config]).await?;
    std::fs::remove_file(&file_path).ok();

    let mut cidrs = registry.all_cidrs().await;
    cidrs.sort();

    assert_eq!(cidrs.len(), 5);
    assert_eq!(cidrs[0], IpNet::from_str("1.1.1.1/32")?);
    assert_eq!(cidrs[1], IpNet::from_str("8.8.8.8/32")?);
    assert_eq!(cidrs[2], IpNet::from_str("9.9.9.9/32")?);
    assert_eq!(cidrs[3], IpNet::from_str("10.10.10.10/32")?);
    assert_eq!(cidrs[4], IpNet::from_str("172.16.0.0/12")?);

    Ok(())
}

#[tokio::test]
async fn test_command_provider() -> anyhow::Result<()> {
    let config = ProviderConfig::Core(CoreProviderConfig::Command(CommandProviderConfig {
        name: "command-test".to_string(),
        command: "sh".to_string(),
        args: vec!["-c".to_string(), "echo '2.2.2.2/32\n3.3.3.3'".to_string()],
        refresh: None,
        timeout: Some(Duration::from_secs(5)),
        on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
        max_stale: None,
        extra: BTreeMap::new(),
    }));

    let registry = ProviderRegistry::from_configs(&[config]).await?;
    let mut cidrs = registry.all_cidrs().await;
    cidrs.sort();

    assert_eq!(cidrs.len(), 2);
    assert_eq!(cidrs[0], IpNet::from_str("2.2.2.2/32")?);
    assert_eq!(cidrs[1], IpNet::from_str("3.3.3.3/32")?);

    Ok(())
}

#[tokio::test]
async fn test_remote_file_provider() -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 18\r\n\r\n4.4.4.4\n5.5.5.0/24\n";
            let _ = tokio::io::AsyncWriteExt::write_all(&mut socket, response.as_bytes()).await;
        }
    });

    let config = ProviderConfig::Core(CoreProviderConfig::RemoteFile(RemoteFileProviderConfig {
        name: "remote-file-test".to_string(),
        url: format!("http://127.0.0.1:{}/ips", port),
        refresh: None,
        timeout: Some(Duration::from_secs(5)),
        on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
        max_stale: None,
        extra: BTreeMap::new(),
    }));

    let registry = ProviderRegistry::from_configs(&[config]).await?;
    let mut cidrs = registry.all_cidrs().await;
    cidrs.sort();

    assert_eq!(cidrs.len(), 2);
    assert_eq!(cidrs[0], IpNet::from_str("4.4.4.4/32")?);
    assert_eq!(cidrs[1], IpNet::from_str("5.5.5.0/24")?);

    Ok(())
}
