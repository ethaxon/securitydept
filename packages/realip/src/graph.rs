use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    str::FromStr,
};

use http::{HeaderMap, HeaderName};

use crate::{
    config::NodeConfig,
    error::{RealIpError, RealIpResult},
    node_registry::CidrNodeRegistry,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeMatch {
    pub role_id: usize,
    pub role_name: String,
    pub evidence_name: String,
    consumed_header: Option<HeaderName>,
}

#[derive(Default)]
pub(crate) struct RequestNodeState {
    consumed_headers: HashSet<HeaderName>,
}

impl RequestNodeState {
    pub fn commit(&mut self, matched: &NodeMatch) {
        if let Some(header) = &matched.consumed_header {
            self.consumed_headers.insert(header.clone());
        }
    }
}

#[derive(Debug)]
pub(crate) struct CompiledNodeGraph {
    roles: Vec<CompiledRole>,
    leaves: Vec<CompiledLeaf>,
    role_by_name: HashMap<String, usize>,
}

#[derive(Debug)]
struct CompiledRole {
    name: String,
    priority: i32,
    order: usize,
    leaves: Vec<usize>,
    accepts_from: Vec<usize>,
}

#[derive(Debug)]
struct CompiledLeaf {
    name: String,
    priority: i32,
    order: usize,
    matcher: LeafMatcher,
}

#[derive(Debug)]
enum LeafMatcher {
    Cidr,
    TrustedBridgeHeaders(Vec<HeaderName>),
}

impl CompiledNodeGraph {
    pub fn compile(nodes: &[NodeConfig]) -> RealIpResult<Self> {
        let role_by_name: HashMap<String, usize> = nodes
            .iter()
            .enumerate()
            .map(|(index, node)| (node.name().to_string(), index))
            .collect();
        let mut leaves = Vec::new();
        let mut leaf_by_name = HashMap::new();

        for (order, node) in nodes.iter().enumerate() {
            if node.members().is_some() {
                continue;
            }
            let matcher = match node.bridge_headers() {
                Some(headers) => LeafMatcher::TrustedBridgeHeaders(
                    headers
                        .iter()
                        .map(|header| HeaderName::from_str(header).expect("validated header"))
                        .collect(),
                ),
                None if node.is_cidr_backed() => LeafMatcher::Cidr,
                None => {
                    return Err(RealIpError::Config {
                        message: format!(
                            "node `{}` has no runtime matcher implementation",
                            node.name()
                        ),
                    });
                }
            };
            leaf_by_name.insert(node.name(), leaves.len());
            leaves.push(CompiledLeaf {
                name: node.name().to_string(),
                priority: node.priority(),
                order,
                matcher,
            });
        }

        let by_name: HashMap<&str, &NodeConfig> =
            nodes.iter().map(|node| (node.name(), node)).collect();
        let mut roles = Vec::with_capacity(nodes.len());
        for (order, node) in nodes.iter().enumerate() {
            let mut role_leaves = Vec::new();
            collect_role_leaves(
                node.name(),
                &by_name,
                &leaf_by_name,
                &mut HashSet::new(),
                &mut role_leaves,
            );
            role_leaves.sort_by_key(|leaf_id| {
                let leaf = &leaves[*leaf_id];
                (std::cmp::Reverse(leaf.priority), leaf.order)
            });

            let mut accepts_from: Vec<usize> = node
                .accepts_from()
                .iter()
                .map(|name| role_by_name[name])
                .collect();
            accepts_from.sort_by_key(|role_id| {
                let candidate = &nodes[*role_id];
                (std::cmp::Reverse(candidate.priority()), *role_id)
            });

            roles.push(CompiledRole {
                name: node.name().to_string(),
                priority: node.priority(),
                order,
                leaves: role_leaves,
                accepts_from,
            });
        }

        Ok(Self {
            roles,
            leaves,
            role_by_name,
        })
    }

    pub fn role_ids(&self, names: &[String]) -> Vec<usize> {
        let mut ids: Vec<usize> = names.iter().map(|name| self.role_by_name[name]).collect();
        ids.sort_by_key(|role_id| {
            let role = &self.roles[*role_id];
            (std::cmp::Reverse(role.priority), role.order)
        });
        ids
    }

    pub fn accepted_role_ids(&self, role_id: usize) -> &[usize] {
        &self.roles[role_id].accepts_from
    }

    pub fn match_roles(
        &self,
        role_ids: &[usize],
        current_ip: IpAddr,
        peek_ip: Option<IpAddr>,
        headers: &HeaderMap,
        request_state: &RequestNodeState,
        cidr_nodes: &CidrNodeRegistry,
    ) -> Option<NodeMatch> {
        for role_id in role_ids {
            let role = &self.roles[*role_id];
            for leaf_id in &role.leaves {
                let leaf = &self.leaves[*leaf_id];
                let consumed_header = match &leaf.matcher {
                    LeafMatcher::Cidr => {
                        if !cidr_nodes.contains(&leaf.name, current_ip) {
                            continue;
                        }
                        None
                    }
                    LeafMatcher::TrustedBridgeHeaders(bridge_headers) => {
                        let Some(peek_ip) = peek_ip else {
                            continue;
                        };
                        let mut matched_header = None;
                        for header in bridge_headers {
                            if request_state.consumed_headers.contains(header) {
                                continue;
                            }
                            let mut values = headers.get_all(header).iter();
                            let Some(value) = values.next() else {
                                continue;
                            };
                            if values.next().is_some() {
                                continue;
                            }
                            let Ok(value) = value.to_str() else {
                                continue;
                            };
                            if value.trim().parse::<IpAddr>().ok() == Some(peek_ip) {
                                matched_header = Some(header.clone());
                                break;
                            }
                        }
                        let Some(matched_header) = matched_header else {
                            continue;
                        };
                        Some(matched_header)
                    }
                };

                return Some(NodeMatch {
                    role_id: *role_id,
                    role_name: role.name.clone(),
                    evidence_name: leaf.name.clone(),
                    consumed_header,
                });
            }
        }
        None
    }
}

fn collect_role_leaves<'a>(
    node_name: &'a str,
    by_name: &HashMap<&'a str, &'a NodeConfig>,
    leaf_by_name: &HashMap<&'a str, usize>,
    seen: &mut HashSet<usize>,
    output: &mut Vec<usize>,
) {
    let node = by_name[node_name];
    if let Some(members) = node.members() {
        for member in members {
            collect_role_leaves(member, by_name, leaf_by_name, seen, output);
        }
        return;
    }

    let leaf_id = leaf_by_name[node_name];
    if seen.insert(leaf_id) {
        output.push(leaf_id);
    }
}
