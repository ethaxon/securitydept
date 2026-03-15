use std::{collections::BTreeMap, net::IpAddr, path::PathBuf, time::Duration};

use ipnet::IpNet;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::{RealIpError, RealIpResult};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct RealIpConfig {
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub sources: Vec<SourceConfig>,
    #[serde(default)]
    pub fallback: FallbackConfig,
}

impl RealIpConfig {
    pub fn validate(&self) -> RealIpResult<()> {
        let mut provider_names = std::collections::BTreeSet::new();
        for provider in &self.providers {
            if !provider_names.insert(provider.name().to_string()) {
                return Err(RealIpError::Config {
                    message: format!("duplicate provider name `{}`", provider.name()),
                });
            }
            provider.validate()?;
        }

        let known_providers = provider_names;
        let mut source_names = std::collections::BTreeSet::new();
        for source in &self.sources {
            if !source_names.insert(source.name.clone()) {
                return Err(RealIpError::Config {
                    message: format!("duplicate source name `{}`", source.name),
                });
            }

            for provider in &source.peers_from {
                if !known_providers.contains(provider) {
                    return Err(RealIpError::UnknownSourceProvider {
                        source_name: source.name.clone(),
                        provider: provider.clone(),
                    });
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub enum ProviderConfig {
    Core(CoreProviderConfig),
    Custom(CustomProviderConfig),
}

impl ProviderConfig {
    pub fn name(&self) -> &str {
        match self {
            Self::Core(config) => config.name(),
            Self::Custom(config) => &config.name,
        }
    }

    pub fn kind(&self) -> &str {
        match self {
            Self::Core(config) => config.kind(),
            Self::Custom(config) => &config.kind,
        }
    }

    pub fn refresh(&self) -> Option<Duration> {
        match self {
            Self::Core(config) => config.refresh(),
            Self::Custom(config) => config.refresh,
        }
    }

    pub fn timeout(&self) -> Option<Duration> {
        match self {
            Self::Core(config) => config.timeout(),
            Self::Custom(config) => config.timeout,
        }
    }

    pub fn on_refresh_failure(&self) -> RefreshFailurePolicy {
        match self {
            Self::Core(config) => config.on_refresh_failure(),
            Self::Custom(config) => config.on_refresh_failure,
        }
    }

    pub fn max_stale(&self) -> Option<Duration> {
        match self {
            Self::Core(config) => config.max_stale(),
            Self::Custom(config) => config.max_stale,
        }
    }

    pub fn watch_path(&self) -> Option<(&PathBuf, Duration)> {
        match self {
            Self::Core(config) => config.watch_path(),
            Self::Custom(_) => None,
        }
    }

    pub fn inline_cidrs(&self) -> Option<&[IpNet]> {
        match self {
            Self::Core(config) => config.inline_cidrs(),
            Self::Custom(_) => None,
        }
    }

    pub fn local_file_path(&self) -> Option<&PathBuf> {
        match self {
            Self::Core(config) => config.local_file_path(),
            Self::Custom(_) => None,
        }
    }

    pub fn remote_file_url(&self) -> Option<&str> {
        match self {
            Self::Core(config) => config.remote_file_url(),
            Self::Custom(_) => None,
        }
    }

    pub fn command_spec(&self) -> Option<(&str, &[String])> {
        match self {
            Self::Core(config) => config.command_spec(),
            Self::Custom(_) => None,
        }
    }

    pub fn custom(&self) -> Option<&CustomProviderConfig> {
        match self {
            Self::Custom(config) => Some(config),
            Self::Core(_) => None,
        }
    }

    pub fn validate(&self) -> RealIpResult<()> {
        match self {
            Self::Core(config) => config.validate(),
            Self::Custom(config) => {
                if config.kind.trim().is_empty() {
                    return Err(RealIpError::Config {
                        message: format!("custom provider `{}` has empty kind", config.name),
                    });
                }
                Ok(())
            }
        }
    }
}

impl<'de> Deserialize<'de> for ProviderConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let kind = value
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("provider requires string field `kind`"))?;

        match kind {
            "inline" | "local-file" | "remote-file" | "command" => {
                CoreProviderConfig::deserialize(value)
                    .map(ProviderConfig::Core)
                    .map_err(serde::de::Error::custom)
            }
            _ => CustomProviderConfig::deserialize(value)
                .map(ProviderConfig::Custom)
                .map_err(serde::de::Error::custom),
        }
    }
}

impl Serialize for ProviderConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Core(config) => config.serialize(serializer),
            Self::Custom(config) => config.serialize(serializer),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CoreProviderConfig {
    Inline(InlineProviderConfig),
    LocalFile(LocalFileProviderConfig),
    RemoteFile(RemoteFileProviderConfig),
    Command(CommandProviderConfig),
}

impl CoreProviderConfig {
    pub fn name(&self) -> &str {
        match self {
            Self::Inline(config) => &config.name,
            Self::LocalFile(config) => &config.name,
            Self::RemoteFile(config) => &config.name,
            Self::Command(config) => &config.name,
        }
    }

    pub fn kind(&self) -> &str {
        match self {
            Self::Inline(_) => "inline",
            Self::LocalFile(_) => "local-file",
            Self::RemoteFile(_) => "remote-file",
            Self::Command(_) => "command",
        }
    }

    pub fn refresh(&self) -> Option<Duration> {
        match self {
            Self::RemoteFile(config) => config.refresh,
            Self::Command(config) => config.refresh,
            Self::Inline(_) | Self::LocalFile(_) => None,
        }
    }

    pub fn timeout(&self) -> Option<Duration> {
        match self {
            Self::RemoteFile(config) => config.timeout,
            Self::Command(config) => config.timeout,
            Self::Inline(_) | Self::LocalFile(_) => None,
        }
    }

    pub fn on_refresh_failure(&self) -> RefreshFailurePolicy {
        match self {
            Self::RemoteFile(config) => config.on_refresh_failure,
            Self::Command(config) => config.on_refresh_failure,
            Self::Inline(_) | Self::LocalFile(_) => RefreshFailurePolicy::KeepLastGood,
        }
    }

    pub fn max_stale(&self) -> Option<Duration> {
        match self {
            Self::Inline(_) => None,
            Self::LocalFile(config) => config.max_stale,
            Self::RemoteFile(config) => config.max_stale,
            Self::Command(config) => config.max_stale,
        }
    }

    pub fn watch_path(&self) -> Option<(&PathBuf, Duration)> {
        match self {
            Self::LocalFile(config) if config.watch => Some((
                &config.path,
                config.debounce.unwrap_or(Duration::from_secs(2)),
            )),
            _ => None,
        }
    }

    pub fn inline_cidrs(&self) -> Option<&[IpNet]> {
        match self {
            Self::Inline(config) => Some(&config.cidrs),
            _ => None,
        }
    }

    pub fn local_file_path(&self) -> Option<&PathBuf> {
        match self {
            Self::LocalFile(config) => Some(&config.path),
            _ => None,
        }
    }

    pub fn remote_file_url(&self) -> Option<&str> {
        match self {
            Self::RemoteFile(config) => Some(&config.url),
            _ => None,
        }
    }

    pub fn command_spec(&self) -> Option<(&str, &[String])> {
        match self {
            Self::Command(config) => Some((&config.command, &config.args)),
            _ => None,
        }
    }

    pub fn validate(&self) -> RealIpResult<()> {
        if let Self::Inline(config) = self
            && config.cidrs.is_empty()
        {
            return Err(RealIpError::MissingProviderField {
                provider: config.name.clone(),
                field: "cidrs",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct InlineProviderConfig {
    pub name: String,
    pub cidrs: Vec<IpNet>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LocalFileProviderConfig {
    pub name: String,
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
pub struct RemoteFileProviderConfig {
    pub name: String,
    pub url: String,
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
pub struct CommandProviderConfig {
    pub name: String,
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
pub struct CustomProviderConfig {
    pub name: String,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SourceConfig {
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub peers_from: Vec<String>,
    #[serde(default)]
    pub accept_transport: Vec<TransportInputConfig>,
    #[serde(default)]
    pub accept_headers: Vec<HeaderInputConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TransportInputConfig {
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HeaderInputConfig {
    pub kind: String,
    #[serde(default)]
    pub mode: HeaderMode,
    #[serde(default)]
    pub direction: ChainDirection,
    #[serde(default)]
    pub param: Option<String>,
    #[serde(default)]
    pub use_only_if_not_in_trusted_peers: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HeaderMode {
    #[default]
    Single,
    Recursive,
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

pub(crate) fn parse_ip_or_cidr(entry: &str) -> Result<IpNet, ()> {
    if let Ok(net) = entry.parse::<IpNet>() {
        return Ok(net);
    }
    let addr = entry.parse::<IpAddr>().map_err(|_| ())?;
    Ok(IpNet::from(addr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_docker_provider_as_custom_provider() {
        let config: ProviderConfig = serde_json::from_value(serde_json::json!({
            "name": "docker-ingress",
            "kind": "docker-provider",
            "host": "unix:///var/run/docker.sock",
            "networks": ["edge-ingress", "internal-proxy"],
            "refresh": "30s",
            "timeout": "5s",
            "on_refresh_failure": "keep-last-good",
            "max_stale": "10m"
        }))
        .unwrap();

        let ProviderConfig::Custom(custom) = config else {
            panic!("expected custom provider");
        };
        assert_eq!(custom.kind, "docker-provider");
        assert_eq!(custom.name, "docker-ingress");
        assert_eq!(custom.refresh, Some(Duration::from_secs(30)));
        assert_eq!(custom.timeout, Some(Duration::from_secs(5)));
        assert_eq!(custom.max_stale, Some(Duration::from_secs(600)));
        assert_eq!(
            custom.extra.get("host").and_then(serde_json::Value::as_str),
            Some("unix:///var/run/docker.sock")
        );
        assert_eq!(
            custom
                .extra
                .get("networks")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn deserialize_kube_provider_as_custom_provider() {
        let config: ProviderConfig = serde_json::from_value(serde_json::json!({
            "name": "kube-ingress-pods",
            "kind": "kube-provider",
            "resource": "pods",
            "namespace": "ingress-nginx",
            "label_selector": "app.kubernetes.io/name=ingress-nginx",
            "refresh": "30s",
            "timeout": "5s"
        }))
        .unwrap();

        let ProviderConfig::Custom(custom) = config else {
            panic!("expected custom provider");
        };
        assert_eq!(custom.kind, "kube-provider");
        assert_eq!(custom.name, "kube-ingress-pods");
        assert_eq!(custom.refresh, Some(Duration::from_secs(30)));
        assert_eq!(custom.timeout, Some(Duration::from_secs(5)));
        assert_eq!(
            custom
                .extra
                .get("resource")
                .and_then(serde_json::Value::as_str),
            Some("pods")
        );
        assert_eq!(
            custom
                .extra
                .get("namespace")
                .and_then(serde_json::Value::as_str),
            Some("ingress-nginx")
        );
        assert_eq!(
            custom
                .extra
                .get("label_selector")
                .and_then(serde_json::Value::as_str),
            Some("app.kubernetes.io/name=ingress-nginx")
        );
    }
}
