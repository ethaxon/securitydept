use std::{net::IpAddr, sync::Arc};

use bollard::{
    API_DEFAULT_VERSION, Docker,
    models::Network,
    network::ListNetworksOptions,
};
use ipnet::IpNet;
use k8s_openapi::api::{
    core::v1::{Endpoints, Pod},
    discovery::v1::EndpointSlice,
};
use kube::{Api, Client, api::ListParams};

use crate::{
    config::CustomProviderConfig,
    error::{RealIpError, RealIpResult},
    extension::{CustomProviderFactory, DynamicProvider, ProviderFactoryRegistry, ProviderLoadFuture},
};

pub fn register_builtin_provider_factories(
    registry: &mut ProviderFactoryRegistry,
) -> RealIpResult<()> {
    registry.register(DockerProviderFactory)?;
    registry.register(KubeProviderFactory)?;
    Ok(())
}

pub struct DockerProviderFactory;

impl CustomProviderFactory for DockerProviderFactory {
    fn kind(&self) -> &'static str {
        "docker-provider"
    }

    fn create(&self, config: &CustomProviderConfig) -> RealIpResult<Arc<dyn DynamicProvider>> {
        let host = config
            .extra
            .get("host")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let networks = string_list(config, "networks");
        let docker = connect_docker(host.as_deref()).map_err(|error| RealIpError::ProviderLoad {
            provider: config.name.clone(),
            details: error,
        })?;

        Ok(Arc::new(DockerProvider {
            provider_name: config.name.clone(),
            docker,
            networks,
        }))
    }
}

struct DockerProvider {
    provider_name: String,
    docker: Docker,
    networks: Vec<String>,
}

impl DynamicProvider for DockerProvider {
    fn load<'a>(&'a self) -> ProviderLoadFuture<'a> {
        Box::pin(async move {
            let networks = if self.networks.is_empty() {
                self.docker
                    .list_networks(None::<ListNetworksOptions<String>>)
                    .await
                    .map_err(|error| RealIpError::ProviderLoad {
                        provider: self.provider_name.clone(),
                        details: error.to_string(),
                    })?
            } else {
                let mut items = Vec::new();
                for network in &self.networks {
                    let item = self
                        .docker
                        .inspect_network(
                            network,
                            None::<bollard::network::InspectNetworkOptions<String>>,
                        )
                        .await
                        .map_err(|error| RealIpError::ProviderLoad {
                            provider: self.provider_name.clone(),
                            details: error.to_string(),
                        })?;
                    items.push(item);
                }
                items
            };

            extract_docker_subnets(&self.provider_name, &networks)
        })
    }
}

pub struct KubeProviderFactory;

impl CustomProviderFactory for KubeProviderFactory {
    fn kind(&self) -> &'static str {
        "kube-provider"
    }

    fn create(&self, config: &CustomProviderConfig) -> RealIpResult<Arc<dyn DynamicProvider>> {
        let resource = config
            .extra
            .get("resource")
            .and_then(|value| value.as_str())
            .unwrap_or("pods")
            .to_string();
        let namespace = config
            .extra
            .get("namespace")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let name = config
            .extra
            .get("name")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let label_selector = config
            .extra
            .get("label_selector")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let field_selector = config
            .extra
            .get("field_selector")
            .and_then(|value| value.as_str())
            .map(str::to_string);

        Ok(Arc::new(KubeProvider {
            provider_name: config.name.clone(),
            resource,
            namespace,
            name,
            label_selector,
            field_selector,
        }))
    }
}

struct KubeProvider {
    provider_name: String,
    resource: String,
    namespace: Option<String>,
    name: Option<String>,
    label_selector: Option<String>,
    field_selector: Option<String>,
}

impl DynamicProvider for KubeProvider {
    fn load<'a>(&'a self) -> ProviderLoadFuture<'a> {
        Box::pin(async move {
            let client = Client::try_default()
                .await
                .map_err(|error| RealIpError::ProviderLoad {
                    provider: self.provider_name.clone(),
                    details: error.to_string(),
                })?;
            let params = list_params(self.label_selector.as_deref(), self.field_selector.as_deref());

            match self.resource.as_str() {
                "pods" => load_kube_pods(
                    &self.provider_name,
                    client,
                    self.namespace.as_deref(),
                    params,
                )
                .await,
                "endpoints" => {
                    load_kube_endpoints(
                        &self.provider_name,
                        client,
                        self.namespace.as_deref(),
                        self.name.as_deref(),
                        params,
                    )
                    .await
                }
                "endpointslices" | "endpoint-slices" => {
                    load_kube_endpoint_slices(
                        &self.provider_name,
                        client,
                        self.namespace.as_deref(),
                        params,
                    )
                    .await
                }
                other => Err(RealIpError::ProviderLoad {
                    provider: self.provider_name.clone(),
                    details: format!("unsupported kube resource `{other}`"),
                }),
            }
        })
    }
}

fn connect_docker(host: Option<&str>) -> Result<Docker, String> {
    match host {
        None => Docker::connect_with_local_defaults().map_err(|error| error.to_string()),
        Some(host) if host.starts_with("unix://") => Docker::connect_with_local(
            host.trim_start_matches("unix://"),
            120,
            API_DEFAULT_VERSION,
        )
        .map_err(|error| error.to_string()),
        Some(host) => Docker::connect_with_http(host, 120, API_DEFAULT_VERSION)
            .map_err(|error| error.to_string()),
    }
}

fn extract_docker_subnets(provider: &str, networks: &[Network]) -> RealIpResult<Vec<IpNet>> {
    let mut cidrs = Vec::new();
    for network in networks {
        let Some(ipam) = &network.ipam else {
            continue;
        };
        let Some(configs) = &ipam.config else {
            continue;
        };
        for config in configs {
            let Some(subnet) = &config.subnet else {
                continue;
            };
            cidrs.push(subnet.parse::<IpNet>().map_err(|_| RealIpError::ProviderLoad {
                provider: provider.to_string(),
                details: format!("invalid docker subnet `{subnet}`"),
            })?);
        }
    }
    Ok(cidrs)
}

fn list_params(label_selector: Option<&str>, field_selector: Option<&str>) -> ListParams {
    let mut params = ListParams::default();
    if let Some(selector) = label_selector {
        params = params.labels(selector);
    }
    if let Some(selector) = field_selector {
        params = params.fields(selector);
    }
    params
}

async fn load_kube_pods(
    provider: &str,
    client: Client,
    namespace: Option<&str>,
    params: ListParams,
) -> RealIpResult<Vec<IpNet>> {
    let pods: Api<Pod> = match namespace {
        Some(namespace) => Api::namespaced(client, namespace),
        None => Api::all(client),
    };
    let list = pods.list(&params).await.map_err(|error| RealIpError::ProviderLoad {
        provider: provider.to_string(),
        details: error.to_string(),
    })?;

    let mut cidrs = Vec::new();
    for pod in list.items {
        let Some(status) = pod.status else {
            continue;
        };
        let Some(ip) = status.pod_ip else {
            continue;
        };
        cidrs.push(
            ip.parse::<IpNet>()
                .unwrap_or_else(|_| IpNet::from(ip.parse::<IpAddr>().unwrap())),
        );
    }
    Ok(cidrs)
}

async fn load_kube_endpoints(
    provider: &str,
    client: Client,
    namespace: Option<&str>,
    name: Option<&str>,
    params: ListParams,
) -> RealIpResult<Vec<IpNet>> {
    let namespace = namespace.ok_or_else(|| RealIpError::ProviderLoad {
        provider: provider.to_string(),
        details: "kube endpoints require `namespace`".to_string(),
    })?;
    let api: Api<Endpoints> = Api::namespaced(client, namespace);

    let endpoints = if let Some(name) = name {
        vec![api.get(name).await.map_err(|error| RealIpError::ProviderLoad {
            provider: provider.to_string(),
            details: error.to_string(),
        })?]
    } else {
        api.list(&params)
            .await
            .map_err(|error| RealIpError::ProviderLoad {
                provider: provider.to_string(),
                details: error.to_string(),
            })?
            .items
    };

    let mut cidrs = Vec::new();
    for endpoints in endpoints {
        let Some(subsets) = endpoints.subsets else {
            continue;
        };
        for subset in subsets {
            for address in subset.addresses.unwrap_or_default() {
                cidrs.push(
                    address
                        .ip
                        .parse::<IpNet>()
                        .unwrap_or_else(|_| IpNet::from(address.ip.parse::<IpAddr>().unwrap())),
                );
            }
        }
    }
    Ok(cidrs)
}

async fn load_kube_endpoint_slices(
    provider: &str,
    client: Client,
    namespace: Option<&str>,
    params: ListParams,
) -> RealIpResult<Vec<IpNet>> {
    let api: Api<EndpointSlice> = match namespace {
        Some(namespace) => Api::namespaced(client, namespace),
        None => Api::all(client),
    };
    let list = api.list(&params).await.map_err(|error| RealIpError::ProviderLoad {
        provider: provider.to_string(),
        details: error.to_string(),
    })?;

    let mut cidrs = Vec::new();
    for slice in list.items {
        for endpoint in slice.endpoints {
            for address in endpoint.addresses {
                cidrs.push(
                    address
                        .parse::<IpNet>()
                        .unwrap_or_else(|_| IpNet::from(address.parse::<IpAddr>().unwrap())),
                );
            }
        }
    }
    Ok(cidrs)
}

fn string_list(config: &CustomProviderConfig, key: &str) -> Vec<String> {
    if let Some(value) = config.extra.get(key) {
        if let Some(items) = value.as_array() {
            return items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::to_string)
                .collect();
        }
        if let Some(item) = value.as_str() {
            return vec![item.to_string()];
        }
    }
    Vec::new()
}
