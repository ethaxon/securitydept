use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

use bollard::{Docker, models::NetworkCreateRequest, query_parameters::InspectNetworkOptions};
use ipnet::IpNet;
use securitydept_realip::{
    ProviderRegistry,
    config::{CustomProviderConfig, ProviderConfig, RefreshFailurePolicy},
};

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

    docker
        .create_network(NetworkCreateRequest {
            name: network_name.clone(),
            driver: Some("bridge".to_string()),
            ..Default::default()
        })
        .await
        .unwrap();

    let inspected_network = docker
        .inspect_network(&network_name, None::<InspectNetworkOptions>)
        .await
        .unwrap();
    let expected_subnets: Vec<IpNet> = inspected_network
        .ipam
        .into_iter()
        .flat_map(|ipam| ipam.config.into_iter().flatten())
        .filter_map(|config| config.subnet)
        .map(|subnet| subnet.parse().unwrap())
        .collect();
    assert!(!expected_subnets.is_empty());

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

    assert_eq!(cidrs, expected_subnets);

    docker.remove_network(&network_name).await.unwrap();
}
