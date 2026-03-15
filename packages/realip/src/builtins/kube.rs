use std::{future::Future, net::IpAddr, pin::Pin, sync::Arc};

use ipnet::IpNet;
use k8s_openapi::api::{
    core::v1::{Endpoints, Pod},
    discovery::v1::EndpointSlice,
};
use kube::{Api, Client, api::ListParams};

use crate::{
    config::CustomProviderConfig,
    error::{RealIpError, RealIpResult},
    extension::{CustomProviderFactory, DynamicProvider, ProviderLoadFuture},
};

pub(crate) struct KubeProviderFactory;

impl CustomProviderFactory for KubeProviderFactory {
    fn kind(&self) -> &'static str {
        "kube-provider"
    }

    fn create(&self, config: &CustomProviderConfig) -> RealIpResult<Arc<dyn DynamicProvider>> {
        Ok(Arc::new(KubeProvider::from_config(config)))
    }
}

struct KubeProvider {
    provider_name: String,
    request: KubeProviderRequest,
}

impl KubeProvider {
    fn from_config(config: &CustomProviderConfig) -> Self {
        Self {
            provider_name: config.name.clone(),
            request: KubeProviderRequest {
                resource: config
                    .extra
                    .get("resource")
                    .and_then(|value| value.as_str())
                    .unwrap_or("pods")
                    .to_string(),
                namespace: config
                    .extra
                    .get("namespace")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                name: config
                    .extra
                    .get("name")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                label_selector: config
                    .extra
                    .get("label_selector")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                field_selector: config
                    .extra
                    .get("field_selector")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            },
        }
    }
}

impl DynamicProvider for KubeProvider {
    fn load<'a>(&'a self) -> ProviderLoadFuture<'a> {
        Box::pin(async move {
            let backend = LiveKubeBackend::new(&self.provider_name).await?;
            load_with_backend(&self.provider_name, &backend, &self.request).await
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct KubeProviderRequest {
    resource: String,
    namespace: Option<String>,
    name: Option<String>,
    label_selector: Option<String>,
    field_selector: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct KubeListQuery {
    namespace: Option<String>,
    label_selector: Option<String>,
    field_selector: Option<String>,
}

type KubeLoadFuture<'a, T> = Pin<Box<dyn Future<Output = RealIpResult<T>> + Send + 'a>>;

trait KubeBackend: Send + Sync {
    fn list_pods<'a>(&'a self, query: &'a KubeListQuery) -> KubeLoadFuture<'a, Vec<Pod>>;
    fn get_endpoints<'a>(
        &'a self,
        namespace: &'a str,
        name: &'a str,
    ) -> KubeLoadFuture<'a, Endpoints>;
    fn list_endpoints<'a>(&'a self, query: &'a KubeListQuery)
    -> KubeLoadFuture<'a, Vec<Endpoints>>;
    fn list_endpoint_slices<'a>(
        &'a self,
        query: &'a KubeListQuery,
    ) -> KubeLoadFuture<'a, Vec<EndpointSlice>>;
}

struct LiveKubeBackend {
    provider_name: String,
    client: Client,
}

impl LiveKubeBackend {
    async fn new(provider_name: &str) -> RealIpResult<Self> {
        let client = Client::try_default()
            .await
            .map_err(|error| RealIpError::ProviderLoad {
                provider: provider_name.to_string(),
                details: error.to_string(),
            })?;
        Ok(Self {
            provider_name: provider_name.to_string(),
            client,
        })
    }
}

impl KubeBackend for LiveKubeBackend {
    fn list_pods<'a>(&'a self, query: &'a KubeListQuery) -> KubeLoadFuture<'a, Vec<Pod>> {
        Box::pin(async move {
            let api: Api<Pod> = match query.namespace.as_deref() {
                Some(namespace) => Api::namespaced(self.client.clone(), namespace),
                None => Api::all(self.client.clone()),
            };
            let list =
                api.list(&list_params(query))
                    .await
                    .map_err(|error| RealIpError::ProviderLoad {
                        provider: self.provider_name.clone(),
                        details: error.to_string(),
                    })?;
            Ok(list.items)
        })
    }

    fn get_endpoints<'a>(
        &'a self,
        namespace: &'a str,
        name: &'a str,
    ) -> KubeLoadFuture<'a, Endpoints> {
        Box::pin(async move {
            let api: Api<Endpoints> = Api::namespaced(self.client.clone(), namespace);
            api.get(name)
                .await
                .map_err(|error| RealIpError::ProviderLoad {
                    provider: self.provider_name.clone(),
                    details: error.to_string(),
                })
        })
    }

    fn list_endpoints<'a>(
        &'a self,
        query: &'a KubeListQuery,
    ) -> KubeLoadFuture<'a, Vec<Endpoints>> {
        Box::pin(async move {
            let namespace =
                query
                    .namespace
                    .as_deref()
                    .ok_or_else(|| RealIpError::ProviderLoad {
                        provider: self.provider_name.clone(),
                        details: "kube endpoints require `namespace`".to_string(),
                    })?;
            let api: Api<Endpoints> = Api::namespaced(self.client.clone(), namespace);
            let list =
                api.list(&list_params(query))
                    .await
                    .map_err(|error| RealIpError::ProviderLoad {
                        provider: self.provider_name.clone(),
                        details: error.to_string(),
                    })?;
            Ok(list.items)
        })
    }

    fn list_endpoint_slices<'a>(
        &'a self,
        query: &'a KubeListQuery,
    ) -> KubeLoadFuture<'a, Vec<EndpointSlice>> {
        Box::pin(async move {
            let api: Api<EndpointSlice> = match query.namespace.as_deref() {
                Some(namespace) => Api::namespaced(self.client.clone(), namespace),
                None => Api::all(self.client.clone()),
            };
            let list =
                api.list(&list_params(query))
                    .await
                    .map_err(|error| RealIpError::ProviderLoad {
                        provider: self.provider_name.clone(),
                        details: error.to_string(),
                    })?;
            Ok(list.items)
        })
    }
}

async fn load_with_backend(
    provider: &str,
    backend: &dyn KubeBackend,
    request: &KubeProviderRequest,
) -> RealIpResult<Vec<IpNet>> {
    let query = KubeListQuery {
        namespace: request.namespace.clone(),
        label_selector: request.label_selector.clone(),
        field_selector: request.field_selector.clone(),
    };

    match request.resource.as_str() {
        "pods" => Ok(extract_pod_cidrs(&backend.list_pods(&query).await?)),
        "endpoints" => {
            let namespace =
                request
                    .namespace
                    .as_deref()
                    .ok_or_else(|| RealIpError::ProviderLoad {
                        provider: provider.to_string(),
                        details: "kube endpoints require `namespace`".to_string(),
                    })?;
            let items = if let Some(name) = request.name.as_deref() {
                vec![backend.get_endpoints(namespace, name).await?]
            } else {
                backend.list_endpoints(&query).await?
            };
            Ok(extract_endpoints_cidrs(&items))
        }
        "endpointslices" | "endpoint-slices" => Ok(extract_endpoint_slice_cidrs(
            &backend.list_endpoint_slices(&query).await?,
        )),
        other => Err(RealIpError::ProviderLoad {
            provider: provider.to_string(),
            details: format!("unsupported kube resource `{other}`"),
        }),
    }
}

fn list_params(query: &KubeListQuery) -> ListParams {
    let mut params = ListParams::default();
    if let Some(selector) = query.label_selector.as_deref() {
        params = params.labels(selector);
    }
    if let Some(selector) = query.field_selector.as_deref() {
        params = params.fields(selector);
    }
    params
}

fn parse_ipnet_or_addr(value: &str) -> Option<IpNet> {
    value
        .parse::<IpNet>()
        .ok()
        .or_else(|| value.parse::<IpAddr>().ok().map(IpNet::from))
}

fn extract_pod_cidrs(items: &[Pod]) -> Vec<IpNet> {
    let mut cidrs = Vec::new();
    for pod in items {
        let Some(status) = &pod.status else {
            continue;
        };
        let Some(ip) = status.pod_ip.as_deref() else {
            continue;
        };
        if let Some(net) = parse_ipnet_or_addr(ip) {
            cidrs.push(net);
        }
    }
    cidrs
}

fn extract_endpoints_cidrs(items: &[Endpoints]) -> Vec<IpNet> {
    let mut cidrs = Vec::new();
    for endpoints in items {
        let Some(subsets) = &endpoints.subsets else {
            continue;
        };
        for subset in subsets {
            for address in subset.addresses.as_deref().unwrap_or_default() {
                if let Some(net) = parse_ipnet_or_addr(&address.ip) {
                    cidrs.push(net);
                }
            }
        }
    }
    cidrs
}

fn extract_endpoint_slice_cidrs(items: &[EndpointSlice]) -> Vec<IpNet> {
    let mut cidrs = Vec::new();
    for slice in items {
        for endpoint in &slice.endpoints {
            for address in &endpoint.addresses {
                if let Some(net) = parse_ipnet_or_addr(address) {
                    cidrs.push(net);
                }
            }
        }
    }
    cidrs
}

#[cfg(test)]
mod tests {
    use std::{collections::VecDeque, sync::Mutex};

    use k8s_openapi::{
        api::core::v1::{EndpointAddress, EndpointSubset, PodStatus},
        apimachinery::pkg::apis::meta::v1::ObjectMeta,
    };

    use super::*;

    #[derive(Default)]
    struct FakeKubeBackend {
        pods: Vec<Pod>,
        endpoints: Vec<Endpoints>,
        endpoint_slices: Vec<EndpointSlice>,
        named_endpoints: VecDeque<Endpoints>,
        calls: Vec<FakeCall>,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum FakeCall {
        ListPods(KubeListQuery),
        GetEndpoints { namespace: String, name: String },
        ListEndpoints(KubeListQuery),
        ListEndpointSlices(KubeListQuery),
    }

    impl KubeBackend for Mutex<FakeKubeBackend> {
        fn list_pods<'a>(&'a self, query: &'a KubeListQuery) -> KubeLoadFuture<'a, Vec<Pod>> {
            Box::pin(async move {
                let mut state = self.lock().unwrap();
                state.calls.push(FakeCall::ListPods(query.clone()));
                Ok(state.pods.clone())
            })
        }

        fn get_endpoints<'a>(
            &'a self,
            namespace: &'a str,
            name: &'a str,
        ) -> KubeLoadFuture<'a, Endpoints> {
            Box::pin(async move {
                let mut state = self.lock().unwrap();
                state.calls.push(FakeCall::GetEndpoints {
                    namespace: namespace.to_string(),
                    name: name.to_string(),
                });
                state
                    .named_endpoints
                    .pop_front()
                    .ok_or_else(|| RealIpError::ProviderLoad {
                        provider: "fake".to_string(),
                        details: "missing fake named endpoints".to_string(),
                    })
            })
        }

        fn list_endpoints<'a>(
            &'a self,
            query: &'a KubeListQuery,
        ) -> KubeLoadFuture<'a, Vec<Endpoints>> {
            Box::pin(async move {
                let mut state = self.lock().unwrap();
                state.calls.push(FakeCall::ListEndpoints(query.clone()));
                Ok(state.endpoints.clone())
            })
        }

        fn list_endpoint_slices<'a>(
            &'a self,
            query: &'a KubeListQuery,
        ) -> KubeLoadFuture<'a, Vec<EndpointSlice>> {
            Box::pin(async move {
                let mut state = self.lock().unwrap();
                state
                    .calls
                    .push(FakeCall::ListEndpointSlices(query.clone()));
                Ok(state.endpoint_slices.clone())
            })
        }
    }

    #[test]
    fn extract_pod_cidrs_skips_missing_and_invalid_ips() {
        let pods = vec![
            Pod {
                status: Some(PodStatus {
                    pod_ip: Some("10.0.0.2".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Pod {
                status: Some(PodStatus {
                    pod_ip: Some("10.0.1.0/24".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Pod {
                status: Some(PodStatus {
                    pod_ip: Some("invalid".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Pod::default(),
        ];

        let cidrs = extract_pod_cidrs(&pods);
        assert_eq!(
            cidrs.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["10.0.0.2/32", "10.0.1.0/24"]
        );
    }

    #[test]
    fn extract_endpoints_cidrs_collects_all_addresses() {
        let endpoints = vec![Endpoints {
            subsets: Some(vec![EndpointSubset {
                addresses: Some(vec![
                    EndpointAddress {
                        ip: "192.168.1.10".to_string(),
                        ..Default::default()
                    },
                    EndpointAddress {
                        ip: "fd00::10".to_string(),
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        }];

        let cidrs = extract_endpoints_cidrs(&endpoints);
        assert_eq!(
            cidrs.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["192.168.1.10/32", "fd00::10/128"]
        );
    }

    #[test]
    fn extract_endpoint_slice_cidrs_collects_addresses() {
        let slices = vec![EndpointSlice {
            endpoints: vec![k8s_openapi::api::discovery::v1::Endpoint {
                addresses: vec!["10.10.0.5".to_string(), "fd00::20".to_string()],
                ..Default::default()
            }],
            ..Default::default()
        }];

        let cidrs = extract_endpoint_slice_cidrs(&slices);
        assert_eq!(
            cidrs.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["10.10.0.5/32", "fd00::20/128"]
        );
    }

    #[tokio::test]
    async fn load_with_backend_dispatches_pod_queries_and_selectors() {
        let backend = Mutex::new(FakeKubeBackend {
            pods: vec![Pod {
                status: Some(PodStatus {
                    pod_ip: Some("10.1.0.3".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        });
        let request = KubeProviderRequest {
            resource: "pods".to_string(),
            namespace: Some("ingress".to_string()),
            name: None,
            label_selector: Some("app=test".to_string()),
            field_selector: Some("spec.nodeName=node-a".to_string()),
        };

        let cidrs = load_with_backend("test-kube", &backend, &request)
            .await
            .unwrap();

        assert_eq!(cidrs[0].to_string(), "10.1.0.3/32");
        let calls = &backend.lock().unwrap().calls;
        assert_eq!(
            calls,
            &[FakeCall::ListPods(KubeListQuery {
                namespace: Some("ingress".to_string()),
                label_selector: Some("app=test".to_string()),
                field_selector: Some("spec.nodeName=node-a".to_string()),
            })]
        );
    }

    #[tokio::test]
    async fn load_with_backend_requires_namespace_for_endpoints() {
        let backend = Mutex::new(FakeKubeBackend::default());
        let request = KubeProviderRequest {
            resource: "endpoints".to_string(),
            namespace: None,
            name: None,
            label_selector: None,
            field_selector: None,
        };

        let error = load_with_backend("test-kube", &backend, &request)
            .await
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("kube endpoints require `namespace`")
        );
        assert!(backend.lock().unwrap().calls.is_empty());
    }

    #[tokio::test]
    async fn load_with_backend_uses_named_endpoints_lookup() {
        let backend = Mutex::new(FakeKubeBackend {
            named_endpoints: VecDeque::from([Endpoints {
                metadata: ObjectMeta {
                    name: Some("ingress".to_string()),
                    ..Default::default()
                },
                subsets: Some(vec![EndpointSubset {
                    addresses: Some(vec![EndpointAddress {
                        ip: "172.16.0.8".to_string(),
                        ..Default::default()
                    }]),
                    ..Default::default()
                }]),
            }]),
            ..Default::default()
        });
        let request = KubeProviderRequest {
            resource: "endpoints".to_string(),
            namespace: Some("ingress-nginx".to_string()),
            name: Some("ingress".to_string()),
            label_selector: Some("ignored=yes".to_string()),
            field_selector: None,
        };

        let cidrs = load_with_backend("test-kube", &backend, &request)
            .await
            .unwrap();

        assert_eq!(cidrs[0].to_string(), "172.16.0.8/32");
        let calls = &backend.lock().unwrap().calls;
        assert_eq!(
            calls,
            &[FakeCall::GetEndpoints {
                namespace: "ingress-nginx".to_string(),
                name: "ingress".to_string(),
            }]
        );
    }

    #[tokio::test]
    async fn load_with_backend_dispatches_endpoint_slices() {
        let backend = Mutex::new(FakeKubeBackend {
            endpoint_slices: vec![EndpointSlice {
                endpoints: vec![k8s_openapi::api::discovery::v1::Endpoint {
                    addresses: vec!["10.2.0.10".to_string()],
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        });
        let request = KubeProviderRequest {
            resource: "endpoint-slices".to_string(),
            namespace: Some("kube-system".to_string()),
            name: None,
            label_selector: Some("kubernetes.io/service-name=dns".to_string()),
            field_selector: None,
        };

        let cidrs = load_with_backend("test-kube", &backend, &request)
            .await
            .unwrap();

        assert_eq!(cidrs[0].to_string(), "10.2.0.10/32");
        let calls = &backend.lock().unwrap().calls;
        assert_eq!(
            calls,
            &[FakeCall::ListEndpointSlices(KubeListQuery {
                namespace: Some("kube-system".to_string()),
                label_selector: Some("kubernetes.io/service-name=dns".to_string()),
                field_selector: None,
            })]
        );
    }

    #[tokio::test]
    async fn load_with_backend_rejects_unsupported_resource() {
        let backend = Mutex::new(FakeKubeBackend::default());
        let request = KubeProviderRequest {
            resource: "services".to_string(),
            namespace: None,
            name: None,
            label_selector: None,
            field_selector: None,
        };

        let error = load_with_backend("test-kube", &backend, &request)
            .await
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("unsupported kube resource `services`")
        );
    }
}
