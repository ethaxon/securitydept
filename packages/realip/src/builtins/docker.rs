use std::sync::Arc;

use bollard::{API_DEFAULT_VERSION, Docker, models::Ipam, query_parameters::InspectNetworkOptions};
use ipnet::IpNet;

use super::string_list;
use crate::{
    config::CustomProviderConfig,
    error::{RealIpError, RealIpResult},
    extension::{CustomProviderFactory, DynamicProvider, ProviderLoadFuture},
};

pub(crate) struct DockerProviderFactory;

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
        let docker =
            connect_docker(host.as_deref()).map_err(|error| RealIpError::ProviderLoad {
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
            let ipams: Vec<Option<Ipam>> = if self.networks.is_empty() {
                self.docker
                    .list_networks(None::<bollard::query_parameters::ListNetworksOptions>)
                    .await
                    .map_err(|error| RealIpError::ProviderLoad {
                        provider: self.provider_name.clone(),
                        details: error.to_string(),
                    })?
                    .into_iter()
                    .map(|n| n.ipam)
                    .collect()
            } else {
                let mut items = Vec::new();
                for network in &self.networks {
                    let item = self
                        .docker
                        .inspect_network(network, None::<InspectNetworkOptions>)
                        .await
                        .map_err(|error| RealIpError::ProviderLoad {
                            provider: self.provider_name.clone(),
                            details: error.to_string(),
                        })?;
                    items.push(item.ipam);
                }
                items
            };

            extract_docker_subnets(&self.provider_name, &ipams)
        })
    }
}

fn connect_docker(host: Option<&str>) -> Result<Docker, String> {
    match host {
        None => Docker::connect_with_local_defaults().map_err(|error| error.to_string()),
        Some(host) if host.starts_with("unix://") => {
            Docker::connect_with_local(host.trim_start_matches("unix://"), 120, API_DEFAULT_VERSION)
                .map_err(|error| error.to_string())
        }
        Some(host) => Docker::connect_with_http(host, 120, API_DEFAULT_VERSION)
            .map_err(|error| error.to_string()),
    }
}

fn extract_docker_subnets(provider: &str, ipams: &[Option<Ipam>]) -> RealIpResult<Vec<IpNet>> {
    let mut cidrs = Vec::new();
    for ipam in ipams {
        let Some(ipam) = ipam else {
            continue;
        };
        let Some(configs) = &ipam.config else {
            continue;
        };
        for config in configs {
            let Some(subnet) = &config.subnet else {
                continue;
            };
            cidrs.push(
                subnet
                    .parse::<IpNet>()
                    .map_err(|_| RealIpError::ProviderLoad {
                        provider: provider.to_string(),
                        details: format!("invalid docker subnet `{subnet}`"),
                    })?,
            );
        }
    }
    Ok(cidrs)
}

#[cfg(test)]
mod tests {
    use bollard::models::{Ipam, IpamConfig};

    use super::extract_docker_subnets;

    #[test]
    fn extract_docker_subnets_parses_all_valid_subnets() {
        let cidrs = extract_docker_subnets(
            "docker-test",
            &[Some(Ipam {
                config: Some(vec![
                    IpamConfig {
                        subnet: Some("10.0.0.0/24".to_string()),
                        ..Default::default()
                    },
                    IpamConfig {
                        subnet: Some("fd00::/64".to_string()),
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            })],
        )
        .unwrap();

        assert_eq!(cidrs.len(), 2);
        assert_eq!(cidrs[0].to_string(), "10.0.0.0/24");
        assert_eq!(cidrs[1].to_string(), "fd00::/64");
    }
}
