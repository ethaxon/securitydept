use std::{collections::HashSet, net::IpAddr};

use http::HeaderMap;
use ipnet::IpNet;
use rfc7239::parse as parse_forwarded;

use crate::{
    config::{ChainDirection, FallbackStrategy, HeaderInputConfig, HeaderMode, RealIpConfig},
    extension::ProviderFactoryRegistry,
    error::RealIpResult,
    providers::{ProviderRegistry, ProviderSnapshot},
};

#[derive(Debug, Clone, Default)]
pub struct TransportContext {
    pub proxy_protocol_addr: Option<IpAddr>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedSourceKind {
    Transport,
    Header,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedClientIp {
    pub client_ip: IpAddr,
    pub peer_ip: IpAddr,
    pub source_name: Option<String>,
    pub source_kind: ResolvedSourceKind,
    pub header_name: Option<String>,
}

#[derive(Debug, Clone)]
struct CompiledSource {
    name: String,
    priority: i32,
    peer_cidrs: Vec<IpNet>,
    accept_transport: Vec<String>,
    accept_headers: Vec<HeaderInputConfig>,
}

pub struct RealIpResolver {
    config: RealIpConfig,
    providers: ProviderRegistry,
}

impl RealIpResolver {
    pub async fn from_config(config: RealIpConfig) -> RealIpResult<Self> {
        let factories = ProviderFactoryRegistry::with_builtin_providers()?;
        Self::from_config_with_factories(config, &factories).await
    }

    pub async fn from_config_with_factories(
        config: RealIpConfig,
        factories: &ProviderFactoryRegistry,
    ) -> RealIpResult<Self> {
        config.validate()?;
        let providers = ProviderRegistry::from_configs_with_factories(&config.providers, factories).await?;
        Ok(Self { config, providers })
    }

    pub async fn resolve(
        &self,
        peer_ip: IpAddr,
        headers: &HeaderMap,
        transport: &TransportContext,
    ) -> ResolvedClientIp {
        let compiled_sources = self.compile_sources().await;
        let trusted_peers = self.providers.all_cidrs().await;
        let trusted_set = TrustedSet::new(trusted_peers);

        for source in compiled_sources {
            if !source.matches_peer(peer_ip) {
                continue;
            }

            if let Some(result) = source.resolve_transport(peer_ip, transport) {
                return result;
            }

            if let Some(result) = source.resolve_headers(peer_ip, headers, &trusted_set) {
                return result;
            }
        }

        match self.config.fallback.strategy {
            FallbackStrategy::RemoteAddr => ResolvedClientIp {
                client_ip: peer_ip,
                peer_ip,
                source_name: None,
                source_kind: ResolvedSourceKind::Fallback,
                header_name: None,
            },
        }
    }

    async fn compile_sources(&self) -> Vec<CompiledSource> {
        let mut compiled = Vec::with_capacity(self.config.sources.len());
        for source in &self.config.sources {
            let mut peer_cidrs = Vec::new();
            for provider_name in &source.peers_from {
                if let Some(ProviderSnapshot { cidrs, .. }) =
                    self.providers.snapshot(provider_name).await
                {
                    peer_cidrs.extend(cidrs.iter().copied());
                }
            }

            compiled.push(CompiledSource {
                name: source.name.clone(),
                priority: source.priority,
                peer_cidrs,
                accept_transport: source
                    .accept_transport
                    .iter()
                    .map(|item| item.kind.to_ascii_lowercase())
                    .collect(),
                accept_headers: source.accept_headers.clone(),
            });
        }

        compiled.sort_by_key(|right| std::cmp::Reverse(right.priority));
        compiled
    }
}

impl CompiledSource {
    fn matches_peer(&self, peer_ip: IpAddr) -> bool {
        self.peer_cidrs.iter().any(|cidr| cidr.contains(&peer_ip))
    }

    fn resolve_transport(
        &self,
        peer_ip: IpAddr,
        transport: &TransportContext,
    ) -> Option<ResolvedClientIp> {
        if self
            .accept_transport
            .iter()
            .any(|kind| kind == "proxy-protocol")
            && let Some(proxy_ip) = transport.proxy_protocol_addr
        {
            return Some(ResolvedClientIp {
                client_ip: proxy_ip,
                peer_ip,
                source_name: Some(self.name.clone()),
                source_kind: ResolvedSourceKind::Transport,
                header_name: Some("proxy-protocol".to_string()),
            });
        }

        None
    }

    fn resolve_headers(
        &self,
        peer_ip: IpAddr,
        headers: &HeaderMap,
        trusted_set: &TrustedSet,
    ) -> Option<ResolvedClientIp> {
        for header in &self.accept_headers {
            let kind = header.kind.to_ascii_lowercase();
            let candidate = match header.mode {
                HeaderMode::Single => resolve_single_header(headers, &kind),
                HeaderMode::Recursive => resolve_chain_header(headers, &kind, header, trusted_set),
            };

            let candidate = match candidate {
                Some(ip) => ip,
                None => continue,
            };

            if header.use_only_if_not_in_trusted_peers && trusted_set.contains(candidate) {
                continue;
            }

            return Some(ResolvedClientIp {
                client_ip: candidate,
                peer_ip,
                source_name: Some(self.name.clone()),
                source_kind: ResolvedSourceKind::Header,
                header_name: Some(kind),
            });
        }

        None
    }
}

#[derive(Debug, Clone)]
struct TrustedSet {
    cidrs: Vec<IpNet>,
}

impl TrustedSet {
    fn new(cidrs: Vec<IpNet>) -> Self {
        let mut unique = HashSet::new();
        let mut deduped = Vec::new();
        for cidr in cidrs {
            if unique.insert(cidr) {
                deduped.push(cidr);
            }
        }
        Self { cidrs: deduped }
    }

    fn contains(&self, ip: IpAddr) -> bool {
        self.cidrs.iter().any(|cidr| cidr.contains(&ip))
    }
}

fn resolve_single_header(headers: &HeaderMap, kind: &str) -> Option<IpAddr> {
    headers
        .get(kind)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<IpAddr>().ok())
}

fn resolve_chain_header(
    headers: &HeaderMap,
    kind: &str,
    config: &HeaderInputConfig,
    trusted_set: &TrustedSet,
) -> Option<IpAddr> {
    let chain = match kind {
        "x-forwarded-for" => parse_x_forwarded_for(headers),
        "forwarded" => parse_forwarded_for(headers, config.param.as_deref().unwrap_or("for")),
        _ => Vec::new(),
    };

    resolve_from_chain(&chain, trusted_set, config.direction)
}

fn parse_x_forwarded_for(headers: &HeaderMap) -> Vec<IpAddr> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .into_iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter_map(|value| value.parse::<IpAddr>().ok())
        .collect()
}

fn parse_forwarded_for(headers: &HeaderMap, param: &str) -> Vec<IpAddr> {
    let Some(raw) = headers
        .get(http::header::FORWARDED)
        .and_then(|value| value.to_str().ok())
    else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for node in parse_forwarded(raw).flatten() {
        if param != "for" {
            continue;
        }
        let Some(value) = node.forwarded_for.map(|value| value.to_string()) else {
            continue;
        };
        if let Some(ip) = parse_forwarded_ip(&value) {
            result.push(ip);
        }
    }
    result
}

fn parse_forwarded_ip(value: &str) -> Option<IpAddr> {
    let trimmed = value.trim().trim_matches('"');
    let without_brackets = trimmed
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(trimmed);

    if let Ok(ip) = without_brackets.parse::<IpAddr>() {
        return Some(ip);
    }

    if let Some((host, _port)) = without_brackets.rsplit_once(':')
        && let Ok(ip) = host.parse::<IpAddr>()
    {
        return Some(ip);
    }

    None
}

fn resolve_from_chain(
    chain: &[IpAddr],
    trusted_set: &TrustedSet,
    direction: ChainDirection,
) -> Option<IpAddr> {
    let iter: Box<dyn Iterator<Item = &IpAddr>> = match direction {
        ChainDirection::LeftToRight => Box::new(chain.iter()),
        ChainDirection::RightToLeft => Box::new(chain.iter().rev()),
    };

    let mut last = None;
    for ip in iter {
        last = Some(*ip);
        if !trusted_set.contains(*ip) {
            return Some(*ip);
        }
    }

    match direction {
        ChainDirection::LeftToRight => chain.last().copied().or(last),
        ChainDirection::RightToLeft => chain.first().copied().or(last),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, net::IpAddr, path::PathBuf};
    use std::sync::Arc;

    use http::HeaderMap;

    use super::*;
    use crate::config::{
        CommandProviderConfig, CoreProviderConfig, CustomProviderConfig, HeaderInputConfig, HeaderMode,
        InlineProviderConfig, LocalFileProviderConfig, ProviderConfig, RefreshFailurePolicy,
        SourceConfig,
    };
    use crate::extension::{
        CustomProviderFactory, DynamicProvider, ProviderFactoryRegistry, ProviderLoadFuture,
    };

    fn temp_file(name: &str, content: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("securitydept-realip-{name}-{}", std::process::id()));
        fs::write(&path, content).unwrap();
        path
    }

    #[tokio::test]
    async fn resolves_recursive_xff_after_skipping_trusted_proxies() {
        let config = RealIpConfig {
            providers: vec![
                ProviderConfig::Core(CoreProviderConfig::Inline(InlineProviderConfig {
                    name: "cloudflare".to_string(),
                    cidrs: vec!["203.0.113.0/24".parse().unwrap()],
                    extra: Default::default(),
                })),
                ProviderConfig::Core(CoreProviderConfig::Inline(InlineProviderConfig {
                    name: "edgeone".to_string(),
                    cidrs: vec!["198.51.100.0/24".parse().unwrap()],
                    extra: Default::default(),
                })),
            ],
            sources: vec![SourceConfig {
                name: "cloudflare".to_string(),
                priority: 100,
                peers_from: vec!["cloudflare".to_string()],
                accept_transport: vec![],
                accept_headers: vec![
                    HeaderInputConfig {
                        kind: "cf-connecting-ip".to_string(),
                        mode: HeaderMode::Single,
                        direction: ChainDirection::RightToLeft,
                        param: None,
                        use_only_if_not_in_trusted_peers: true,
                    },
                    HeaderInputConfig {
                        kind: "x-forwarded-for".to_string(),
                        mode: HeaderMode::Recursive,
                        direction: ChainDirection::RightToLeft,
                        param: None,
                        use_only_if_not_in_trusted_peers: false,
                    },
                ],
            }],
            fallback: Default::default(),
        };
        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let peer_ip: IpAddr = "203.0.113.10".parse().unwrap();

        let mut headers = HeaderMap::new();
        headers.insert("cf-connecting-ip", "198.51.100.2".parse().unwrap());
        headers.insert(
            "x-forwarded-for",
            "198.18.0.10, 198.51.100.2".parse().unwrap(),
        );

        let resolved = resolver
            .resolve(peer_ip, &headers, &TransportContext::default())
            .await;

        assert_eq!(resolved.client_ip, "198.18.0.10".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.header_name.as_deref(), Some("x-forwarded-for"));
    }

    #[tokio::test]
    async fn loads_local_file_provider() {
        let path = temp_file("local-provider", "127.0.0.1/32\n::1/128\n");
        let config = RealIpConfig {
            providers: vec![ProviderConfig::Core(CoreProviderConfig::LocalFile(
                LocalFileProviderConfig {
                name: "local".to_string(),
                path: path.clone(),
                watch: false,
                debounce: None,
                max_stale: None,
                extra: Default::default(),
            },
            ))],
            sources: vec![],
            fallback: Default::default(),
        };

        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let trusted = resolver.providers.all_cidrs().await;
        assert_eq!(trusted.len(), 2);

        let _ = fs::remove_file(path);
    }

    #[tokio::test]
    async fn loads_command_provider() {
        let config = RealIpConfig {
            providers: vec![ProviderConfig::Core(CoreProviderConfig::Command(
                CommandProviderConfig {
                name: "command".to_string(),
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    "printf '10.0.0.1\\n10.0.0.0/24\\n'".to_string(),
                ],
                refresh: None,
                timeout: Some(std::time::Duration::from_secs(5)),
                on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
                max_stale: None,
                extra: Default::default(),
            },
            ))],
            sources: vec![],
            fallback: Default::default(),
        };

        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let trusted = resolver.providers.all_cidrs().await;
        assert_eq!(trusted.len(), 2);
    }

    struct StaticCustomProvider {
        cidrs: Vec<IpNet>,
    }

    impl DynamicProvider for StaticCustomProvider {
        fn load<'a>(&'a self) -> ProviderLoadFuture<'a> {
            let cidrs = self.cidrs.clone();
            Box::pin(async move { Ok(cidrs) })
        }
    }

    struct StaticCustomProviderFactory;

    impl CustomProviderFactory for StaticCustomProviderFactory {
        fn kind(&self) -> &'static str {
            "static-custom"
        }

        fn create(&self, config: &CustomProviderConfig) -> RealIpResult<Arc<dyn DynamicProvider>> {
            let cidrs = config
                .extra
                .get("cidrs")
                .and_then(|value| value.as_array())
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str())
                .map(|value| value.parse::<IpNet>().unwrap())
                .collect();
            Ok(Arc::new(StaticCustomProvider { cidrs }))
        }
    }

    #[tokio::test]
    async fn loads_custom_provider_via_factory_registry() {
        let mut factories = ProviderFactoryRegistry::new();
        factories.register(StaticCustomProviderFactory).unwrap();

        let config = RealIpConfig {
            providers: vec![ProviderConfig::Custom(CustomProviderConfig {
                name: "custom".to_string(),
                kind: "static-custom".to_string(),
                refresh: None,
                timeout: None,
                on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
                max_stale: None,
                extra: [
                    (
                        "cidrs".to_string(),
                        serde_json::json!(["10.10.0.0/16", "127.0.0.1/32"]),
                    ),
                ]
                .into_iter()
                .collect(),
            })],
            sources: vec![],
            fallback: Default::default(),
        };

        let resolver = RealIpResolver::from_config_with_factories(config, &factories)
            .await
            .unwrap();
        let trusted = resolver.providers.all_cidrs().await;
        assert_eq!(trusted.len(), 2);
    }
}
