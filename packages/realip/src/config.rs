use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    net::IpAddr,
    path::PathBuf,
    str::FromStr,
    time::Duration,
};

use http::HeaderName;
use ipnet::IpNet;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::{RealIpError, RealIpResult};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(deny_unknown_fields)]
pub struct RealIpResolveConfig {
    #[serde(default)]
    pub rules: Vec<RuleConfig>,
    #[serde(default)]
    pub nodes: Vec<NodeConfig>,
    #[serde(default)]
    pub fallback: FallbackConfig,
}

impl RealIpResolveConfig {
    pub fn validate(&self) -> RealIpResult<()> {
        let mut node_names = BTreeSet::new();
        for node in &self.nodes {
            if !node_names.insert(node.name().to_string()) {
                return Err(config_error(format!(
                    "duplicate real-IP node name `{}`",
                    node.name()
                )));
            }
            node.validate()?;
        }

        for node in &self.nodes {
            for referenced in node
                .accepts_from()
                .iter()
                .chain(node.members().unwrap_or_default())
            {
                if !node_names.contains(referenced) {
                    return Err(config_error(format!(
                        "node `{}` references unknown node `{referenced}`",
                        node.name()
                    )));
                }
            }
        }

        validate_union_memberships(&self.nodes)?;

        let mut rule_names = BTreeSet::new();
        for rule in &self.rules {
            if !rule_names.insert(rule.name().to_string()) {
                return Err(config_error(format!(
                    "duplicate real-IP rule name `{}`",
                    rule.name()
                )));
            }
            rule.validate()?;
            for node in rule.direct_peer_nodes() {
                if !node_names.contains(node) {
                    return Err(config_error(format!(
                        "rule `{}` references unknown direct-peer node `{node}`",
                        rule.name()
                    )));
                }
            }
            for node in rule.skip_if_matches_nodes() {
                if !node_names.contains(node) {
                    return Err(config_error(format!(
                        "rule `{}` references unknown skip-if-matches node `{node}`",
                        rule.name()
                    )));
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RuleConfig {
    XForwardedFor(XForwardedForRuleConfig),
    Forwarded(ForwardedRuleConfig),
    TrustedResolvedHeader(TrustedResolvedHeaderRuleConfig),
    ProxyProtocol(ProxyProtocolRuleConfig),
}

impl RuleConfig {
    pub fn name(&self) -> &str {
        match self {
            Self::XForwardedFor(config) => &config.name,
            Self::Forwarded(config) => &config.name,
            Self::TrustedResolvedHeader(config) => &config.name,
            Self::ProxyProtocol(config) => &config.name,
        }
    }

    pub fn priority(&self) -> i32 {
        match self {
            Self::XForwardedFor(config) => config.priority,
            Self::Forwarded(config) => config.priority,
            Self::TrustedResolvedHeader(config) => config.priority,
            Self::ProxyProtocol(config) => config.priority,
        }
    }

    pub fn direct_peer_nodes(&self) -> &[String] {
        match self {
            Self::XForwardedFor(config) => &config.direct_peer_nodes,
            Self::Forwarded(config) => &config.direct_peer_nodes,
            Self::TrustedResolvedHeader(config) => &config.direct_peer_nodes,
            Self::ProxyProtocol(config) => &config.direct_peer_nodes,
        }
    }

    pub fn skip_if_matches_nodes(&self) -> &[String] {
        match self {
            Self::TrustedResolvedHeader(config) => &config.skip_if_matches_nodes,
            _ => &[],
        }
    }

    fn validate(&self) -> RealIpResult<()> {
        if self.name().trim().is_empty() {
            return Err(config_error("real-IP rule name must not be empty"));
        }
        if self.direct_peer_nodes().is_empty() {
            return Err(config_error(format!(
                "rule `{}` requires at least one direct_peer_nodes entry",
                self.name()
            )));
        }

        match self {
            Self::XForwardedFor(config) => validate_headers(self.name(), &config.headers),
            Self::Forwarded(config) => {
                validate_headers(self.name(), &config.headers)?;
                if !config.param.eq_ignore_ascii_case("for") {
                    return Err(config_error(format!(
                        "rule `{}` only supports Forwarded parameter `for`",
                        self.name()
                    )));
                }
                Ok(())
            }
            Self::TrustedResolvedHeader(config) => validate_headers(self.name(), &config.headers),
            Self::ProxyProtocol(_) => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct XForwardedForRuleConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default = "default_x_forwarded_for_headers")]
    pub headers: Vec<String>,
    #[serde(default)]
    pub direction: ChainDirection,
    pub direct_peer_nodes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ForwardedRuleConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default = "default_forwarded_headers")]
    pub headers: Vec<String>,
    #[serde(default)]
    pub direction: ChainDirection,
    #[serde(default = "default_forwarded_param")]
    pub param: String,
    pub direct_peer_nodes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrustedResolvedHeaderRuleConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    pub headers: Vec<String>,
    pub direct_peer_nodes: Vec<String>,
    #[serde(default)]
    pub skip_if_matches_nodes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProxyProtocolRuleConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    pub direct_peer_nodes: Vec<String>,
}

fn default_x_forwarded_for_headers() -> Vec<String> {
    vec!["x-forwarded-for".to_string()]
}

fn default_forwarded_headers() -> Vec<String> {
    vec!["forwarded".to_string()]
}

fn default_forwarded_param() -> String {
    "for".to_string()
}

#[derive(Debug, Clone)]
pub enum NodeConfig {
    Core(CoreNodeConfig),
    CustomCidr(CustomCidrNodeConfig),
}

impl NodeConfig {
    pub fn name(&self) -> &str {
        match self {
            Self::Core(config) => config.name(),
            Self::CustomCidr(config) => &config.name,
        }
    }

    pub fn kind(&self) -> &str {
        match self {
            Self::Core(config) => config.kind(),
            Self::CustomCidr(config) => &config.kind,
        }
    }

    pub fn priority(&self) -> i32 {
        match self {
            Self::Core(config) => config.priority(),
            Self::CustomCidr(config) => config.priority,
        }
    }

    pub fn accepts_from(&self) -> &[String] {
        match self {
            Self::Core(config) => config.accepts_from(),
            Self::CustomCidr(config) => &config.accepts_from,
        }
    }

    pub fn allow_multiple_unions(&self) -> bool {
        match self {
            Self::Core(config) => config.allow_multiple_unions(),
            Self::CustomCidr(config) => config.allow_multiple_unions,
        }
    }

    pub fn members(&self) -> Option<&[String]> {
        match self {
            Self::Core(CoreNodeConfig::Union(config)) => Some(&config.members),
            _ => None,
        }
    }

    pub fn bridge_headers(&self) -> Option<&[String]> {
        match self {
            Self::Core(CoreNodeConfig::TrustedBridgeHeaders(config)) => Some(&config.headers),
            _ => None,
        }
    }

    pub fn refresh(&self) -> Option<Duration> {
        match self {
            Self::Core(config) => config.refresh(),
            Self::CustomCidr(config) => config.refresh,
        }
    }

    pub fn timeout(&self) -> Option<Duration> {
        match self {
            Self::Core(config) => config.timeout(),
            Self::CustomCidr(config) => config.timeout,
        }
    }

    pub fn on_refresh_failure(&self) -> RefreshFailurePolicy {
        match self {
            Self::Core(config) => config.on_refresh_failure(),
            Self::CustomCidr(config) => config.on_refresh_failure,
        }
    }

    pub fn max_stale(&self) -> Option<Duration> {
        match self {
            Self::Core(config) => config.max_stale(),
            Self::CustomCidr(config) => config.max_stale,
        }
    }

    pub fn watch_path(&self) -> Option<(&PathBuf, Duration)> {
        match self {
            Self::Core(CoreNodeConfig::CidrsLocalFile(config)) if config.watch => Some((
                &config.path,
                config.debounce.unwrap_or(Duration::from_secs(2)),
            )),
            _ => None,
        }
    }

    pub fn inline_cidrs(&self) -> Option<&[IpNet]> {
        match self {
            Self::Core(CoreNodeConfig::CidrsInline(config)) => Some(&config.cidrs),
            _ => None,
        }
    }

    pub fn local_file_path(&self) -> Option<&PathBuf> {
        match self {
            Self::Core(CoreNodeConfig::CidrsLocalFile(config)) => Some(&config.path),
            _ => None,
        }
    }

    pub fn remote_file_urls(&self) -> Option<&[String]> {
        match self {
            Self::Core(CoreNodeConfig::CidrsRemoteFile(config)) => Some(&config.urls),
            _ => None,
        }
    }

    pub fn command_spec(&self) -> Option<(&str, &[String])> {
        match self {
            Self::Core(CoreNodeConfig::CidrsCommand(config)) => {
                Some((&config.command, &config.args))
            }
            _ => None,
        }
    }

    pub fn custom_cidr(&self) -> Option<&CustomCidrNodeConfig> {
        match self {
            Self::CustomCidr(config) => Some(config),
            Self::Core(_) => None,
        }
    }

    pub fn is_cidr_backed(&self) -> bool {
        matches!(
            self,
            Self::Core(
                CoreNodeConfig::CidrsInline(_)
                    | CoreNodeConfig::CidrsLocalFile(_)
                    | CoreNodeConfig::CidrsRemoteFile(_)
                    | CoreNodeConfig::CidrsCommand(_)
            ) | Self::CustomCidr(_)
        )
    }

    fn validate(&self) -> RealIpResult<()> {
        if self.name().trim().is_empty() {
            return Err(config_error("real-IP node name must not be empty"));
        }

        match self {
            Self::Core(config) => config.validate(),
            Self::CustomCidr(config) => {
                if config.kind.trim().is_empty() {
                    return Err(config_error(format!(
                        "custom CIDR node `{}` has an empty kind",
                        config.name
                    )));
                }
                Ok(())
            }
        }
    }
}

impl<'de> Deserialize<'de> for NodeConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let kind = value
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("node requires string field `kind`"))?;

        match kind {
            "cidrs-inline"
            | "cidrs-local-file"
            | "cidrs-remote-file"
            | "cidrs-command"
            | "trusted-bridge-headers"
            | "union" => CoreNodeConfig::deserialize(value)
                .map(Self::Core)
                .map_err(serde::de::Error::custom),
            _ => CustomCidrNodeConfig::deserialize(value)
                .map(Self::CustomCidr)
                .map_err(serde::de::Error::custom),
        }
    }
}

impl Serialize for NodeConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Core(config) => config.serialize(serializer),
            Self::CustomCidr(config) => config.serialize(serializer),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CoreNodeConfig {
    CidrsInline(CidrsInlineNodeConfig),
    CidrsLocalFile(CidrsLocalFileNodeConfig),
    CidrsRemoteFile(CidrsRemoteFileNodeConfig),
    CidrsCommand(CidrsCommandNodeConfig),
    TrustedBridgeHeaders(TrustedBridgeHeadersNodeConfig),
    Union(UnionNodeConfig),
}

impl CoreNodeConfig {
    fn name(&self) -> &str {
        match self {
            Self::CidrsInline(config) => &config.name,
            Self::CidrsLocalFile(config) => &config.name,
            Self::CidrsRemoteFile(config) => &config.name,
            Self::CidrsCommand(config) => &config.name,
            Self::TrustedBridgeHeaders(config) => &config.name,
            Self::Union(config) => &config.name,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::CidrsInline(_) => "cidrs-inline",
            Self::CidrsLocalFile(_) => "cidrs-local-file",
            Self::CidrsRemoteFile(_) => "cidrs-remote-file",
            Self::CidrsCommand(_) => "cidrs-command",
            Self::TrustedBridgeHeaders(_) => "trusted-bridge-headers",
            Self::Union(_) => "union",
        }
    }

    fn priority(&self) -> i32 {
        match self {
            Self::CidrsInline(config) => config.priority,
            Self::CidrsLocalFile(config) => config.priority,
            Self::CidrsRemoteFile(config) => config.priority,
            Self::CidrsCommand(config) => config.priority,
            Self::TrustedBridgeHeaders(config) => config.priority,
            Self::Union(config) => config.priority,
        }
    }

    fn accepts_from(&self) -> &[String] {
        match self {
            Self::CidrsInline(config) => &config.accepts_from,
            Self::CidrsLocalFile(config) => &config.accepts_from,
            Self::CidrsRemoteFile(config) => &config.accepts_from,
            Self::CidrsCommand(config) => &config.accepts_from,
            Self::TrustedBridgeHeaders(config) => &config.accepts_from,
            Self::Union(config) => &config.accepts_from,
        }
    }

    fn allow_multiple_unions(&self) -> bool {
        match self {
            Self::CidrsInline(config) => config.allow_multiple_unions,
            Self::CidrsLocalFile(config) => config.allow_multiple_unions,
            Self::CidrsRemoteFile(config) => config.allow_multiple_unions,
            Self::CidrsCommand(config) => config.allow_multiple_unions,
            Self::TrustedBridgeHeaders(config) => config.allow_multiple_unions,
            Self::Union(_) => true,
        }
    }

    fn refresh(&self) -> Option<Duration> {
        match self {
            Self::CidrsRemoteFile(config) => config.refresh,
            Self::CidrsCommand(config) => config.refresh,
            _ => None,
        }
    }

    fn timeout(&self) -> Option<Duration> {
        match self {
            Self::CidrsRemoteFile(config) => config.timeout,
            Self::CidrsCommand(config) => config.timeout,
            _ => None,
        }
    }

    fn on_refresh_failure(&self) -> RefreshFailurePolicy {
        match self {
            Self::CidrsRemoteFile(config) => config.on_refresh_failure,
            Self::CidrsCommand(config) => config.on_refresh_failure,
            _ => RefreshFailurePolicy::KeepLastGood,
        }
    }

    fn max_stale(&self) -> Option<Duration> {
        match self {
            Self::CidrsLocalFile(config) => config.max_stale,
            Self::CidrsRemoteFile(config) => config.max_stale,
            Self::CidrsCommand(config) => config.max_stale,
            _ => None,
        }
    }

    fn validate(&self) -> RealIpResult<()> {
        match self {
            Self::CidrsInline(config) if config.cidrs.is_empty() => Err(config_error(format!(
                "CIDR node `{}` requires at least one cidrs entry",
                config.name
            ))),
            Self::CidrsRemoteFile(config) if config.urls.is_empty() => Err(config_error(format!(
                "remote CIDR node `{}` requires at least one urls entry",
                config.name
            ))),
            Self::CidrsCommand(config) if config.command.trim().is_empty() => Err(config_error(
                format!("command CIDR node `{}` requires command", config.name),
            )),
            Self::TrustedBridgeHeaders(config) => validate_headers(&config.name, &config.headers),
            Self::Union(config) if config.members.is_empty() => Err(config_error(format!(
                "union node `{}` requires at least one member",
                config.name
            ))),
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CidrsInlineNodeConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub accepts_from: Vec<String>,
    #[serde(default)]
    pub allow_multiple_unions: bool,
    pub cidrs: Vec<IpNet>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CidrsLocalFileNodeConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub accepts_from: Vec<String>,
    #[serde(default)]
    pub allow_multiple_unions: bool,
    pub path: PathBuf,
    #[serde(default)]
    pub watch: bool,
    #[serde(default, with = "humantime_serde::option")]
    pub debounce: Option<Duration>,
    #[serde(default, with = "humantime_serde::option")]
    pub max_stale: Option<Duration>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CidrsRemoteFileNodeConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub accepts_from: Vec<String>,
    #[serde(default)]
    pub allow_multiple_unions: bool,
    pub urls: Vec<String>,
    #[serde(default, with = "humantime_serde::option")]
    pub refresh: Option<Duration>,
    #[serde(default, with = "humantime_serde::option")]
    pub timeout: Option<Duration>,
    #[serde(default)]
    pub on_refresh_failure: RefreshFailurePolicy,
    #[serde(default, with = "humantime_serde::option")]
    pub max_stale: Option<Duration>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CidrsCommandNodeConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub accepts_from: Vec<String>,
    #[serde(default)]
    pub allow_multiple_unions: bool,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, with = "humantime_serde::option")]
    pub refresh: Option<Duration>,
    #[serde(default, with = "humantime_serde::option")]
    pub timeout: Option<Duration>,
    #[serde(default)]
    pub on_refresh_failure: RefreshFailurePolicy,
    #[serde(default, with = "humantime_serde::option")]
    pub max_stale: Option<Duration>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrustedBridgeHeadersNodeConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub accepts_from: Vec<String>,
    #[serde(default)]
    pub allow_multiple_unions: bool,
    pub headers: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UnionNodeConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub accepts_from: Vec<String>,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CustomCidrNodeConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub accepts_from: Vec<String>,
    #[serde(default)]
    pub allow_multiple_unions: bool,
    pub kind: String,
    #[serde(default, with = "humantime_serde::option")]
    pub refresh: Option<Duration>,
    #[serde(default, with = "humantime_serde::option")]
    pub timeout: Option<Duration>,
    #[serde(default)]
    pub on_refresh_failure: RefreshFailurePolicy,
    #[serde(default, with = "humantime_serde::option")]
    pub max_stale: Option<Duration>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ChainDirection {
    LeftToRight,
    #[default]
    RightToLeft,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RefreshFailurePolicy {
    #[default]
    KeepLastGood,
    Clear,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FallbackConfig {
    #[serde(default)]
    pub strategy: FallbackStrategy,
}

impl Default for FallbackConfig {
    fn default() -> Self {
        Self {
            strategy: FallbackStrategy::RemoteAddr,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FallbackStrategy {
    #[default]
    RemoteAddr,
}

fn validate_headers(owner: &str, headers: &[String]) -> RealIpResult<()> {
    if headers.is_empty() {
        return Err(config_error(format!(
            "`{owner}` requires at least one header"
        )));
    }
    let mut unique = BTreeSet::new();
    for header in headers {
        HeaderName::from_str(header)
            .map_err(|_| config_error(format!("`{owner}` has invalid header name `{header}`")))?;
        if !unique.insert(header.to_ascii_lowercase()) {
            return Err(config_error(format!(
                "`{owner}` contains duplicate header `{header}`"
            )));
        }
    }
    Ok(())
}

fn validate_union_memberships(nodes: &[NodeConfig]) -> RealIpResult<()> {
    let by_name: HashMap<&str, &NodeConfig> =
        nodes.iter().map(|node| (node.name(), node)).collect();
    let mut memberships: HashMap<&str, BTreeSet<&str>> = HashMap::new();

    for union in nodes.iter().filter(|node| node.members().is_some()) {
        let mut visiting = Vec::new();
        let mut leaves = BTreeSet::new();
        collect_union_leaves(union.name(), &by_name, &mut visiting, &mut leaves)?;
        for leaf in leaves {
            memberships.entry(leaf).or_default().insert(union.name());
        }
    }

    for (leaf_name, unions) in memberships {
        let leaf = by_name[leaf_name];
        if unions.len() > 1 && !leaf.allow_multiple_unions() {
            return Err(config_error(format!(
                "leaf node `{leaf_name}` belongs to multiple unions ({}) but does not enable \
                 allow_multiple_unions",
                unions.into_iter().collect::<Vec<_>>().join(", ")
            )));
        }
    }
    Ok(())
}

fn collect_union_leaves<'a>(
    node_name: &'a str,
    by_name: &HashMap<&'a str, &'a NodeConfig>,
    visiting: &mut Vec<&'a str>,
    leaves: &mut BTreeSet<&'a str>,
) -> RealIpResult<()> {
    if visiting.contains(&node_name) {
        visiting.push(node_name);
        return Err(config_error(format!(
            "union membership cycle: {}",
            visiting.join(" -> ")
        )));
    }

    let node = by_name[node_name];
    let Some(members) = node.members() else {
        leaves.insert(node_name);
        return Ok(());
    };

    visiting.push(node_name);
    for member in members {
        collect_union_leaves(member, by_name, visiting, leaves)?;
    }
    visiting.pop();
    Ok(())
}

pub(crate) fn parse_ip_or_cidr(entry: &str) -> Result<IpNet, ()> {
    if let Ok(net) = entry.parse::<IpNet>() {
        return Ok(net);
    }
    let addr = entry.parse::<IpAddr>().map_err(|_| ())?;
    Ok(IpNet::from(addr))
}

fn config_error(message: impl Into<String>) -> RealIpError {
    RealIpError::Config {
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inline(name: &str, allow_multiple_unions: bool) -> NodeConfig {
        NodeConfig::Core(CoreNodeConfig::CidrsInline(CidrsInlineNodeConfig {
            name: name.to_string(),
            priority: 0,
            accepts_from: vec![],
            allow_multiple_unions,
            cidrs: vec!["127.0.0.1/32".parse().unwrap()],
            extra: BTreeMap::new(),
        }))
    }

    fn union(name: &str, members: &[&str]) -> NodeConfig {
        NodeConfig::Core(CoreNodeConfig::Union(UnionNodeConfig {
            name: name.to_string(),
            priority: 0,
            accepts_from: vec![],
            members: members.iter().map(ToString::to_string).collect(),
        }))
    }

    #[test]
    fn leaf_requires_explicit_multiple_union_support() {
        let config = RealIpResolveConfig {
            nodes: vec![
                inline("shared", false),
                union("first", &["shared"]),
                union("second", &["shared"]),
            ],
            ..Default::default()
        };
        assert!(matches!(config.validate(), Err(RealIpError::Config { .. })));

        let config = RealIpResolveConfig {
            nodes: vec![
                inline("shared", true),
                union("first", &["shared"]),
                union("second", &["shared"]),
            ],
            ..Default::default()
        };
        config.validate().unwrap();
    }

    #[test]
    fn union_membership_cycles_are_rejected_but_topology_cycles_are_allowed() {
        let cyclic_membership = RealIpResolveConfig {
            nodes: vec![union("first", &["second"]), union("second", &["first"])],
            ..Default::default()
        };
        assert!(matches!(
            cyclic_membership.validate(),
            Err(RealIpError::Config { .. })
        ));

        let mut local = inline("local", false);
        let NodeConfig::Core(CoreNodeConfig::CidrsInline(local_config)) = &mut local else {
            unreachable!();
        };
        local_config.accepts_from = vec!["local".to_string()];
        let topology_cycle = RealIpResolveConfig {
            nodes: vec![local],
            ..Default::default()
        };
        topology_cycle.validate().unwrap();
    }

    #[test]
    fn custom_cidr_node_keeps_extension_fields() {
        let node: NodeConfig = serde_json::from_value(serde_json::json!({
            "name": "docker-ingress",
            "kind": "docker",
            "networks": ["edge-ingress"],
            "refresh": "30s"
        }))
        .unwrap();

        let NodeConfig::CustomCidr(node) = node else {
            panic!("expected a custom CIDR node");
        };
        assert_eq!(node.kind, "docker");
        assert_eq!(node.refresh, Some(Duration::from_secs(30)));
        assert_eq!(
            node.extra
                .get("networks")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn legacy_provider_and_source_fields_are_rejected() {
        let result = serde_json::from_value::<RealIpResolveConfig>(serde_json::json!({
            "providers": [],
            "sources": []
        }));

        assert!(result.is_err());
    }
}
