use std::{
    collections::{BTreeMap, HashMap},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use bollard::{Docker, models::NetworkCreateRequest, query_parameters::InspectNetworkOptions};
use ipnet::IpNet;
use securitydept_realip::{
    ProviderRegistry,
    config::{CustomProviderConfig, ProviderConfig, RefreshFailurePolicy},
};

const TEST_LABEL_KEY: &str = "securitydept.test";
const TEST_LABEL_VALUE: &str = "true";
const TEST_RESOURCE_LABEL_KEY: &str = "securitydept.test.resource";
const TEST_RESOURCE_LABEL_VALUE: &str = "realip-docker-integration-network";

struct DockerNetworkGuard {
    name: String,
    removed: bool,
}

impl DockerNetworkGuard {
    fn new(name: String) -> Self {
        Self {
            name,
            removed: false,
        }
    }

    fn name(&self) -> &str {
        &self.name
    }

    async fn remove(&mut self, docker: &Docker) -> Result<(), bollard::errors::Error> {
        let result = docker.remove_network(&self.name).await;
        if result.is_ok() {
            self.removed = true;
        }
        result
    }
}

impl Drop for DockerNetworkGuard {
    fn drop(&mut self) {
        if self.removed || !self.name.starts_with("securitydept-realip-test-") {
            return;
        }

        let _ = Command::new("docker")
            .args(["network", "rm", &self.name])
            .output();
    }
}

fn unique_network_name() -> String {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("securitydept-realip-test-{suffix}")
}

fn is_unsupported_docker_test_environment(error: &impl std::fmt::Display) -> bool {
    let message = error.to_string();
    message.contains("Failed to Setup IP tables")
        || message.contains("DOCKER-FORWARD")
        || message.contains("iptables failed")
}

#[tokio::test]
async fn docker_provider_loads_configured_network_subnets() {
    let docker = match Docker::connect_with_local_defaults() {
        Ok(docker) => docker,
        Err(error) => {
            eprintln!(
                "skipping docker_provider_loads_configured_network_subnets: Docker is \
                 unavailable: {error}"
            );
            return;
        }
    };
    let mut network = DockerNetworkGuard::new(unique_network_name());

    let create_network_result = docker
        .create_network(NetworkCreateRequest {
            name: network.name().to_string(),
            driver: Some("bridge".to_string()),
            labels: Some(HashMap::from([
                (TEST_LABEL_KEY.to_string(), TEST_LABEL_VALUE.to_string()),
                (
                    TEST_RESOURCE_LABEL_KEY.to_string(),
                    TEST_RESOURCE_LABEL_VALUE.to_string(),
                ),
            ])),
            ..Default::default()
        })
        .await;
    if let Err(error) = create_network_result {
        if is_unsupported_docker_test_environment(&error) {
            eprintln!(
                "skipping docker_provider_loads_configured_network_subnets: Docker bridge \
                 networking is unavailable in this environment: {error}"
            );
            return;
        }

        panic!("failed to create docker test network: {error}");
    }

    let inspected_network = docker
        .inspect_network(network.name(), None::<InspectNetworkOptions>)
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
        serde_json::json!([network.name().to_string()]),
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

    network.remove(&docker).await.unwrap();
}
