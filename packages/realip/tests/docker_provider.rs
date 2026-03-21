use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

use bollard::{
    Docker,
    models::{Ipam, IpamConfig, NetworkCreateRequest},
};
use ipnet::IpNet;
use securitydept_realip::{
    ProviderRegistry,
    config::{CustomProviderConfig, ProviderConfig, RefreshFailurePolicy},
};
use testcontainers::{GenericImage, ImageExt, core::WaitFor, runners::AsyncRunner};

fn unique_network_name() -> String {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("securitydept-realip-test-{suffix}")
}

#[tokio::test]
async fn docker_provider_loads_configured_network_subnets() {
    let docker = Docker::connect_with_local_defaults().unwrap();
    let network_name = unique_network_name();
    let expected_subnet: IpNet = "10.231.0.0/24".parse().unwrap();

    docker
        .create_network(NetworkCreateRequest {
            name: network_name.clone(),
            driver: Some("bridge".to_string()),
            ipam: Some(Ipam {
                config: Some(vec![IpamConfig {
                    subnet: Some(expected_subnet.to_string()),
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            ..Default::default()
        })
        .await
        .unwrap();

    let container = GenericImage::new("alpine", "3.20")
        .with_wait_for(WaitFor::seconds(1))
        .with_cmd(["sh", "-c", "sleep 60"])
        .with_network(network_name.clone())
        .start()
        .await
        .unwrap();

    let mut extra = BTreeMap::new();
    extra.insert(
        "networks".to_string(),
        serde_json::json!([network_name.clone()]),
    );

    let config = ProviderConfig::Custom(CustomProviderConfig {
        name: "docker-test".to_string(),
        kind: "docker-provider".to_string(),
        refresh: None,
        timeout: None,
        on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
        max_stale: None,
        extra,
    });

    let registry = ProviderRegistry::from_configs(&[config]).await.unwrap();
    let cidrs = registry.all_cidrs().await;

    assert_eq!(cidrs, vec![expected_subnet]);

    container.rm().await.unwrap();
    docker.remove_network(&network_name).await.unwrap();
}
