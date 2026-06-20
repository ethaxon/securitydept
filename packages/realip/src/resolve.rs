use std::{net::IpAddr, str::FromStr};

use http::{HeaderMap, HeaderName};
use rfc7239::parse as parse_forwarded;
use tracing::warn;

use crate::{
    config::{ChainDirection, FallbackStrategy, RealIpResolveConfig, RuleConfig},
    error::RealIpResult,
    extension::CidrNodeFactoryRegistry,
    graph::{CompiledNodeGraph, NodeMatch, RequestNodeState},
    node_registry::CidrNodeRegistry,
};

#[derive(Debug, Clone, Default)]
pub struct TransportContext {
    pub proxy_protocol_addr: Option<IpAddr>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedInputKind {
    Transport,
    Header,
    Fallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RealIpRejectionReason {
    MalformedHeaderValue,
    MalformedChainElement,
    MissingForwardedFor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RealIpResolutionStatus {
    Resolved,
    Fallback,
    Rejected { reason: RealIpRejectionReason },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedNodeMatch {
    pub role_name: String,
    pub evidence_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedClientIp {
    pub client_ip: IpAddr,
    pub peer_ip: IpAddr,
    pub rule_name: Option<String>,
    pub input_kind: ResolvedInputKind,
    pub status: RealIpResolutionStatus,
    pub matched_nodes: Vec<ResolvedNodeMatch>,
}

pub struct RealIpResolver {
    fallback: FallbackStrategy,
    rules: Vec<CompiledRule>,
    graph: CompiledNodeGraph,
    cidr_nodes: CidrNodeRegistry,
}

#[derive(Debug)]
struct CompiledRule {
    name: String,
    priority: i32,
    order: usize,
    direct_peer_roles: Vec<usize>,
    kind: CompiledRuleKind,
}

#[derive(Debug)]
enum CompiledRuleKind {
    XForwardedFor {
        headers: Vec<HeaderName>,
        direction: ChainDirection,
    },
    Forwarded {
        headers: Vec<HeaderName>,
        direction: ChainDirection,
    },
    TrustedResolvedHeader {
        headers: Vec<HeaderName>,
        skip_if_matches_roles: Vec<usize>,
    },
    ProxyProtocol,
}

enum RuleOutcome {
    NotApplicable,
    Resolved {
        client_ip: IpAddr,
        input_kind: ResolvedInputKind,
        matched_nodes: Vec<ResolvedNodeMatch>,
    },
    Rejected {
        client_ip: IpAddr,
        input_kind: ResolvedInputKind,
        reason: RealIpRejectionReason,
        matched_nodes: Vec<ResolvedNodeMatch>,
    },
}

struct ChainResolutionContext<'a> {
    headers: &'a HeaderMap,
    graph: &'a CompiledNodeGraph,
    cidr_nodes: &'a CidrNodeRegistry,
}

impl RealIpResolver {
    pub async fn from_config(config: RealIpResolveConfig) -> RealIpResult<Self> {
        let factories = CidrNodeFactoryRegistry::with_builtin_nodes()?;
        Self::from_config_with_factories(config, &factories).await
    }

    pub async fn from_config_with_factories(
        config: RealIpResolveConfig,
        factories: &CidrNodeFactoryRegistry,
    ) -> RealIpResult<Self> {
        config.validate()?;
        let graph = CompiledNodeGraph::compile(&config.nodes)?;
        let cidr_nodes =
            CidrNodeRegistry::from_configs_with_factories(&config.nodes, factories).await?;
        let mut rules: Vec<CompiledRule> = config
            .rules
            .iter()
            .enumerate()
            .map(|(order, rule)| CompiledRule::compile(rule, order, &graph))
            .collect();
        rules.sort_by_key(|rule| (std::cmp::Reverse(rule.priority), rule.order));

        Ok(Self {
            fallback: config.fallback.strategy,
            rules,
            graph,
            cidr_nodes,
        })
    }

    pub async fn resolve(
        &self,
        peer_ip: IpAddr,
        headers: &HeaderMap,
        transport: &TransportContext,
    ) -> ResolvedClientIp {
        for rule in &self.rules {
            match rule.resolve(peer_ip, headers, transport, &self.graph, &self.cidr_nodes) {
                RuleOutcome::NotApplicable => {}
                RuleOutcome::Resolved {
                    client_ip,
                    input_kind,
                    matched_nodes,
                } => {
                    return ResolvedClientIp {
                        client_ip,
                        peer_ip,
                        rule_name: Some(rule.name.clone()),
                        input_kind,
                        status: RealIpResolutionStatus::Resolved,
                        matched_nodes,
                    };
                }
                RuleOutcome::Rejected {
                    client_ip,
                    input_kind,
                    reason,
                    matched_nodes,
                } => {
                    warn!(rule = %rule.name, ?reason, "Rejected malformed real-IP input at the nearest proven hop");
                    return ResolvedClientIp {
                        client_ip,
                        peer_ip,
                        rule_name: Some(rule.name.clone()),
                        input_kind,
                        status: RealIpResolutionStatus::Rejected { reason },
                        matched_nodes,
                    };
                }
            }
        }

        match self.fallback {
            FallbackStrategy::RemoteAddr => ResolvedClientIp {
                client_ip: peer_ip,
                peer_ip,
                rule_name: None,
                input_kind: ResolvedInputKind::Fallback,
                status: RealIpResolutionStatus::Fallback,
                matched_nodes: vec![],
            },
        }
    }
}

impl CompiledRule {
    fn compile(config: &RuleConfig, order: usize, graph: &CompiledNodeGraph) -> Self {
        let kind = match config {
            RuleConfig::XForwardedFor(config) => CompiledRuleKind::XForwardedFor {
                headers: compile_headers(&config.headers),
                direction: config.direction,
            },
            RuleConfig::Forwarded(config) => CompiledRuleKind::Forwarded {
                headers: compile_headers(&config.headers),
                direction: config.direction,
            },
            RuleConfig::TrustedResolvedHeader(config) => CompiledRuleKind::TrustedResolvedHeader {
                headers: compile_headers(&config.headers),
                skip_if_matches_roles: graph.role_ids(&config.skip_if_matches_nodes),
            },
            RuleConfig::ProxyProtocol(_) => CompiledRuleKind::ProxyProtocol,
        };

        Self {
            name: config.name().to_string(),
            priority: config.priority(),
            order,
            direct_peer_roles: graph.role_ids(config.direct_peer_nodes()),
            kind,
        }
    }

    fn resolve(
        &self,
        peer_ip: IpAddr,
        headers: &HeaderMap,
        transport: &TransportContext,
        graph: &CompiledNodeGraph,
        cidr_nodes: &CidrNodeRegistry,
    ) -> RuleOutcome {
        let mut request_state = RequestNodeState::default();
        let Some(direct_peer_match) = graph.match_roles(
            &self.direct_peer_roles,
            peer_ip,
            None,
            headers,
            &request_state,
            cidr_nodes,
        ) else {
            return RuleOutcome::NotApplicable;
        };
        request_state.commit(&direct_peer_match);

        match &self.kind {
            CompiledRuleKind::XForwardedFor {
                headers: names,
                direction,
            } => {
                let Some(chain) = read_chain_headers(headers, names, parse_x_forwarded_for_value)
                else {
                    return RuleOutcome::NotApplicable;
                };
                resolve_chain(
                    peer_ip,
                    direct_peer_match,
                    chain,
                    *direction,
                    request_state,
                    ChainResolutionContext {
                        headers,
                        graph,
                        cidr_nodes,
                    },
                )
            }
            CompiledRuleKind::Forwarded {
                headers: names,
                direction,
            } => {
                let Some(chain) = read_chain_headers(headers, names, parse_forwarded_value) else {
                    return RuleOutcome::NotApplicable;
                };
                resolve_chain(
                    peer_ip,
                    direct_peer_match,
                    chain,
                    *direction,
                    request_state,
                    ChainResolutionContext {
                        headers,
                        graph,
                        cidr_nodes,
                    },
                )
            }
            CompiledRuleKind::TrustedResolvedHeader {
                headers: names,
                skip_if_matches_roles,
            } => resolve_trusted_header(
                headers,
                names,
                peer_ip,
                vec![resolved_node_match(&direct_peer_match)],
                skip_if_matches_roles,
                graph,
                cidr_nodes,
            ),
            CompiledRuleKind::ProxyProtocol => match transport.proxy_protocol_addr {
                Some(client_ip) => RuleOutcome::Resolved {
                    client_ip,
                    input_kind: ResolvedInputKind::Transport,
                    matched_nodes: vec![resolved_node_match(&direct_peer_match)],
                },
                None => RuleOutcome::NotApplicable,
            },
        }
    }
}

fn resolve_chain(
    peer_ip: IpAddr,
    direct_peer_match: NodeMatch,
    mut chain: Vec<Result<IpAddr, RealIpRejectionReason>>,
    direction: ChainDirection,
    mut request_state: RequestNodeState,
    context: ChainResolutionContext<'_>,
) -> RuleOutcome {
    if matches!(direction, ChainDirection::RightToLeft) {
        chain.reverse();
    }

    let mut current_role = direct_peer_match.role_id;
    let mut last_proven_ip = peer_ip;
    let mut matched_nodes = vec![resolved_node_match(&direct_peer_match)];
    for index in 0..chain.len() {
        let candidate_ip = match chain[index] {
            Ok(ip) => ip,
            Err(reason) => {
                return RuleOutcome::Rejected {
                    client_ip: last_proven_ip,
                    input_kind: ResolvedInputKind::Header,
                    reason,
                    matched_nodes,
                };
            }
        };
        let peek_ip = chain
            .get(index + 1)
            .and_then(|value| value.as_ref().ok())
            .copied();
        let Some(matched) = context.graph.match_roles(
            context.graph.accepted_role_ids(current_role),
            candidate_ip,
            peek_ip,
            context.headers,
            &request_state,
            context.cidr_nodes,
        ) else {
            return RuleOutcome::Resolved {
                client_ip: candidate_ip,
                input_kind: ResolvedInputKind::Header,
                matched_nodes,
            };
        };

        request_state.commit(&matched);
        current_role = matched.role_id;
        last_proven_ip = candidate_ip;
        matched_nodes.push(resolved_node_match(&matched));
    }

    RuleOutcome::Resolved {
        client_ip: last_proven_ip,
        input_kind: ResolvedInputKind::Header,
        matched_nodes,
    }
}

fn resolve_trusted_header(
    headers: &HeaderMap,
    names: &[HeaderName],
    peer_ip: IpAddr,
    matched_nodes: Vec<ResolvedNodeMatch>,
    skip_if_matches_roles: &[usize],
    graph: &CompiledNodeGraph,
    cidr_nodes: &CidrNodeRegistry,
) -> RuleOutcome {
    for name in names {
        let mut values = headers.get_all(name).iter();
        let Some(value) = values.next() else {
            continue;
        };
        if values.next().is_some() {
            return rejected_header(peer_ip, matched_nodes);
        }
        let Ok(value) = value.to_str() else {
            return rejected_header(peer_ip, matched_nodes);
        };
        let Ok(client_ip) = value.trim().parse::<IpAddr>() else {
            return rejected_header(peer_ip, matched_nodes);
        };
        if graph
            .match_roles(
                skip_if_matches_roles,
                client_ip,
                None,
                headers,
                &RequestNodeState::default(),
                cidr_nodes,
            )
            .is_some()
        {
            return RuleOutcome::NotApplicable;
        }
        return RuleOutcome::Resolved {
            client_ip,
            input_kind: ResolvedInputKind::Header,
            matched_nodes,
        };
    }
    RuleOutcome::NotApplicable
}

fn rejected_header(peer_ip: IpAddr, matched_nodes: Vec<ResolvedNodeMatch>) -> RuleOutcome {
    RuleOutcome::Rejected {
        client_ip: peer_ip,
        input_kind: ResolvedInputKind::Header,
        reason: RealIpRejectionReason::MalformedHeaderValue,
        matched_nodes,
    }
}

fn read_chain_headers(
    headers: &HeaderMap,
    names: &[HeaderName],
    parse: fn(&str) -> Vec<Result<IpAddr, RealIpRejectionReason>>,
) -> Option<Vec<Result<IpAddr, RealIpRejectionReason>>> {
    for name in names {
        let values = headers.get_all(name);
        if values.iter().next().is_none() {
            continue;
        }
        let mut chain = Vec::new();
        for value in values {
            match value.to_str() {
                Ok(value) => chain.extend(parse(value)),
                Err(_) => chain.push(Err(RealIpRejectionReason::MalformedHeaderValue)),
            }
        }
        return Some(chain);
    }
    None
}

fn parse_x_forwarded_for_value(value: &str) -> Vec<Result<IpAddr, RealIpRejectionReason>> {
    value
        .split(',')
        .map(str::trim)
        .map(|value| {
            value
                .parse::<IpAddr>()
                .map_err(|_| RealIpRejectionReason::MalformedChainElement)
        })
        .collect()
}

fn parse_forwarded_value(value: &str) -> Vec<Result<IpAddr, RealIpRejectionReason>> {
    parse_forwarded(value)
        .map(|node| {
            let node = node.map_err(|_| RealIpRejectionReason::MalformedChainElement)?;
            node.forwarded_for
                .ok_or(RealIpRejectionReason::MissingForwardedFor)?
                .ip()
                .copied()
                .ok_or(RealIpRejectionReason::MalformedChainElement)
        })
        .collect()
}

fn compile_headers(headers: &[String]) -> Vec<HeaderName> {
    headers
        .iter()
        .map(|header| HeaderName::from_str(header).expect("validated header"))
        .collect()
}

fn resolved_node_match(matched: &NodeMatch) -> ResolvedNodeMatch {
    ResolvedNodeMatch {
        role_name: matched.role_name.clone(),
        evidence_name: matched.evidence_name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use ipnet::IpNet;

    use super::*;
    use crate::config::{
        CidrsInlineNodeConfig, CoreNodeConfig, FallbackConfig, NodeConfig,
        TrustedBridgeHeadersNodeConfig, UnionNodeConfig, XForwardedForRuleConfig,
    };

    fn cidr_node(
        name: &str,
        cidrs: &[&str],
        accepts_from: &[&str],
        allow_multiple_unions: bool,
    ) -> NodeConfig {
        NodeConfig::Core(CoreNodeConfig::CidrsInline(CidrsInlineNodeConfig {
            name: name.to_string(),
            priority: 0,
            accepts_from: accepts_from.iter().map(ToString::to_string).collect(),
            allow_multiple_unions,
            cidrs: cidrs
                .iter()
                .map(|cidr| cidr.parse::<IpNet>().unwrap())
                .collect(),
            extra: BTreeMap::new(),
        }))
    }

    fn bridge_node(name: &str, header: &str) -> NodeConfig {
        NodeConfig::Core(CoreNodeConfig::TrustedBridgeHeaders(
            TrustedBridgeHeadersNodeConfig {
                name: name.to_string(),
                priority: 0,
                accepts_from: vec![],
                allow_multiple_unions: false,
                headers: vec![header.to_string()],
            },
        ))
    }

    fn union_node(name: &str, members: &[&str], accepts_from: &[&str]) -> NodeConfig {
        NodeConfig::Core(CoreNodeConfig::Union(UnionNodeConfig {
            name: name.to_string(),
            priority: 0,
            accepts_from: accepts_from.iter().map(ToString::to_string).collect(),
            members: members.iter().map(ToString::to_string).collect(),
        }))
    }

    fn recursive_config() -> RealIpResolveConfig {
        RealIpResolveConfig {
            rules: vec![RuleConfig::XForwardedFor(XForwardedForRuleConfig {
                name: "xff".to_string(),
                priority: 100,
                headers: vec!["x-forwarded-for".to_string()],
                direction: ChainDirection::RightToLeft,
                direct_peer_nodes: vec!["local".to_string()],
            })],
            nodes: vec![
                cidr_node("local-cidrs", &["10.0.0.0/24"], &[], false),
                cidr_node("cloudflare", &["203.0.113.0/24"], &[], false),
                bridge_node("edgeone", "eo-secret-client-ip"),
                union_node("local", &["local-cidrs"], &["local", "cdn"]),
                union_node("cdn", &["cloudflare", "edgeone"], &["cdn"]),
            ],
            fallback: FallbackConfig::default(),
        }
    }

    #[tokio::test]
    async fn recursively_resolves_cidr_and_bridge_nodes() {
        let resolver = RealIpResolver::from_config(recursive_config())
            .await
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "198.18.0.10, 198.51.100.9, 203.0.113.8, 10.0.0.3"
                .parse()
                .unwrap(),
        );
        headers.insert("eo-secret-client-ip", "198.18.0.10".parse().unwrap());

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "198.18.0.10".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.status, RealIpResolutionStatus::Resolved);
        assert_eq!(
            resolved
                .matched_nodes
                .iter()
                .map(|matched| (matched.role_name.as_str(), matched.evidence_name.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("local", "local-cidrs"),
                ("local", "local-cidrs"),
                ("cdn", "cloudflare"),
                ("cdn", "edgeone"),
            ]
        );
    }

    #[tokio::test]
    async fn missing_bridge_proof_stops_at_unknown_proxy() {
        let resolver = RealIpResolver::from_config(recursive_config())
            .await
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "198.18.0.10, 198.51.100.9, 203.0.113.8, 10.0.0.3"
                .parse()
                .unwrap(),
        );

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(
            resolved.client_ip,
            "198.51.100.9".parse::<IpAddr>().unwrap()
        );
        assert_eq!(resolved.status, RealIpResolutionStatus::Resolved);
    }

    #[tokio::test]
    async fn fully_trusted_chain_returns_farthest_clientward_node() {
        let config = RealIpResolveConfig {
            rules: vec![RuleConfig::XForwardedFor(XForwardedForRuleConfig {
                name: "lan-xff".to_string(),
                priority: 100,
                headers: vec!["x-forwarded-for".to_string()],
                direction: ChainDirection::RightToLeft,
                direct_peer_nodes: vec!["lan".to_string()],
            })],
            nodes: vec![cidr_node("lan", &["192.168.0.0/16"], &["lan"], false)],
            fallback: FallbackConfig::default(),
        };
        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "192.168.1.1, 192.168.1.2".parse().unwrap(),
        );

        let resolved = resolver
            .resolve(
                "192.168.1.3".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "192.168.1.1".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.status, RealIpResolutionStatus::Resolved);
        assert_eq!(resolved.matched_nodes.len(), 3);
    }

    #[tokio::test]
    async fn different_bridge_headers_can_prove_multiple_cdn_hops() {
        let mut config = recursive_config();
        config
            .nodes
            .insert(3, bridge_node("second-edge", "second-secret-client-ip"));
        let NodeConfig::Core(CoreNodeConfig::Union(cdn)) = &mut config.nodes[5] else {
            unreachable!();
        };
        cdn.members.push("second-edge".to_string());

        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "198.18.0.10, 198.51.100.9, 198.51.100.8, 10.0.0.3"
                .parse()
                .unwrap(),
        );
        headers.insert("eo-secret-client-ip", "198.18.0.10".parse().unwrap());
        headers.insert("second-secret-client-ip", "198.51.100.9".parse().unwrap());

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "198.18.0.10".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.status, RealIpResolutionStatus::Resolved);
        assert_eq!(
            resolved
                .matched_nodes
                .iter()
                .map(|matched| matched.evidence_name.as_str())
                .collect::<Vec<_>>(),
            vec!["local-cidrs", "local-cidrs", "second-edge", "edgeone"]
        );
    }

    #[tokio::test]
    async fn a_bridge_header_can_only_prove_one_hop_per_request() {
        let mut config = recursive_config();
        let NodeConfig::Core(CoreNodeConfig::Union(cdn)) = &mut config.nodes[4] else {
            unreachable!();
        };
        cdn.members = vec!["edgeone".to_string()];

        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "198.18.0.10, 198.51.100.9, 198.51.100.8, 10.0.0.3"
                .parse()
                .unwrap(),
        );
        headers.insert("eo-secret-client-ip", "198.51.100.9".parse().unwrap());

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(
            resolved.client_ip,
            "198.51.100.9".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            resolved
                .matched_nodes
                .iter()
                .filter(|matched| matched.evidence_name == "edgeone")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn malformed_chain_returns_rejected_nearest_proven_hop() {
        let resolver = RealIpResolver::from_config(recursive_config())
            .await
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            "198.18.0.10, malformed, 203.0.113.8, 10.0.0.3"
                .parse()
                .unwrap(),
        );

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "203.0.113.8".parse::<IpAddr>().unwrap());
        assert_eq!(
            resolved.status,
            RealIpResolutionStatus::Rejected {
                reason: RealIpRejectionReason::MalformedChainElement,
            }
        );
    }

    #[tokio::test]
    async fn malformed_forwarded_chain_is_not_compacted() {
        let mut config = recursive_config();
        config.rules = vec![RuleConfig::Forwarded(crate::config::ForwardedRuleConfig {
            name: "forwarded".to_string(),
            priority: 100,
            headers: vec!["forwarded".to_string()],
            direction: ChainDirection::RightToLeft,
            param: "for".to_string(),
            direct_peer_nodes: vec!["local".to_string()],
        })];
        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            "for=198.18.0.10, by=unknown, for=203.0.113.8, for=10.0.0.3"
                .parse()
                .unwrap(),
        );

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "203.0.113.8".parse::<IpAddr>().unwrap());
        assert_eq!(
            resolved.status,
            RealIpResolutionStatus::Rejected {
                reason: RealIpRejectionReason::MissingForwardedFor,
            }
        );
    }

    #[tokio::test]
    async fn shared_leaf_keeps_each_union_role_topology_isolated() {
        let mut shared_node = cidr_node("shared", &["10.0.0.0/24"], &[], true);
        let NodeConfig::Core(CoreNodeConfig::CidrsInline(shared_config)) = &mut shared_node else {
            unreachable!();
        };
        shared_config.priority = 100;
        let config = RealIpResolveConfig {
            rules: vec![RuleConfig::XForwardedFor(XForwardedForRuleConfig {
                name: "xff".to_string(),
                priority: 100,
                headers: vec!["x-forwarded-for".to_string()],
                direction: ChainDirection::RightToLeft,
                direct_peer_nodes: vec!["edge".to_string(), "internal".to_string()],
            })],
            nodes: vec![
                shared_node,
                cidr_node("edge-upstream", &["203.0.113.0/24"], &[], false),
                cidr_node("internal-upstream", &["192.0.2.0/24"], &[], false),
                union_node("edge", &["shared"], &["edge-upstream"]),
                union_node("internal", &["shared"], &["internal-upstream"]),
            ],
            fallback: FallbackConfig::default(),
        };
        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "192.0.2.8".parse().unwrap());

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "192.0.2.8".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.matched_nodes.len(), 1);
        assert_eq!(resolved.matched_nodes[0].role_name, "edge");
    }

    #[tokio::test]
    async fn untrusted_direct_peer_uses_fallback_without_reading_headers() {
        let resolver = RealIpResolver::from_config(recursive_config())
            .await
            .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "198.18.0.10".parse().unwrap());

        let resolved = resolver
            .resolve(
                "192.0.2.10".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "192.0.2.10".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.status, RealIpResolutionStatus::Fallback);
    }

    #[tokio::test]
    async fn trusted_resolved_header_can_defer_when_candidate_is_still_a_proxy() {
        let config = RealIpResolveConfig {
            rules: vec![
                RuleConfig::TrustedResolvedHeader(crate::config::TrustedResolvedHeaderRuleConfig {
                    name: "resolved".to_string(),
                    priority: 100,
                    headers: vec!["x-real-ip".to_string()],
                    direct_peer_nodes: vec!["cloudflare".to_string()],
                    skip_if_matches_nodes: vec!["cloudflare".to_string()],
                }),
                RuleConfig::XForwardedFor(XForwardedForRuleConfig {
                    name: "xff".to_string(),
                    priority: 90,
                    headers: vec!["x-forwarded-for".to_string()],
                    direction: ChainDirection::RightToLeft,
                    direct_peer_nodes: vec!["cloudflare".to_string()],
                }),
            ],
            nodes: vec![cidr_node(
                "cloudflare",
                &["203.0.113.0/24"],
                &["cloudflare"],
                false,
            )],
            fallback: FallbackConfig::default(),
        };
        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "203.0.113.9".parse().unwrap());
        headers.insert(
            "x-forwarded-for",
            "198.18.0.10, 203.0.113.9".parse().unwrap(),
        );

        let resolved = resolver
            .resolve(
                "203.0.113.8".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;

        assert_eq!(resolved.client_ip, "198.18.0.10".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.rule_name.as_deref(), Some("xff"));
    }

    #[tokio::test]
    async fn trusted_resolved_header_and_proxy_protocol_remain_supported() {
        let config = RealIpResolveConfig {
            rules: vec![
                RuleConfig::ProxyProtocol(crate::config::ProxyProtocolRuleConfig {
                    name: "proxy".to_string(),
                    priority: 100,
                    direct_peer_nodes: vec!["local".to_string()],
                }),
                RuleConfig::TrustedResolvedHeader(crate::config::TrustedResolvedHeaderRuleConfig {
                    name: "resolved".to_string(),
                    priority: 90,
                    headers: vec!["x-real-ip".to_string()],
                    direct_peer_nodes: vec!["local".to_string()],
                    skip_if_matches_nodes: vec![],
                }),
            ],
            nodes: vec![cidr_node("local", &["10.0.0.0/24"], &[], false)],
            fallback: FallbackConfig::default(),
        };
        let resolver = RealIpResolver::from_config(config).await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "198.18.0.10".parse().unwrap());

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext::default(),
            )
            .await;
        assert_eq!(resolved.client_ip, "198.18.0.10".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.rule_name.as_deref(), Some("resolved"));

        let resolved = resolver
            .resolve(
                "10.0.0.2".parse().unwrap(),
                &headers,
                &TransportContext {
                    proxy_protocol_addr: Some("203.0.113.7".parse().unwrap()),
                },
            )
            .await;
        assert_eq!(resolved.client_ip, "203.0.113.7".parse::<IpAddr>().unwrap());
        assert_eq!(resolved.input_kind, ResolvedInputKind::Transport);
    }
}
