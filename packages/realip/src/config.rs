use std::{collections::BTreeMap, net::IpAddr, path::PathBuf, time::Duration};

use ipnet::IpNet;
use serde::{Deserialize, Serialize};

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
            if !provider_names.insert(provider.name.clone()) {
                return Err(RealIpError::Config {
                    message: format!("duplicate provider name `{}`", provider.name),
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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderConfig {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub cidrs: Vec<IpNet>,
    #[serde(default)]
    pub path: Option<PathBuf>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, with = "duration_opt_serde")]
    pub refresh: Option<Duration>,
    #[serde(default)]
    pub watch: bool,
    #[serde(default, with = "duration_opt_serde")]
    pub debounce: Option<Duration>,
    #[serde(default, with = "duration_opt_serde")]
    pub timeout: Option<Duration>,
    #[serde(default)]
    pub on_refresh_failure: RefreshFailurePolicy,
    #[serde(default, with = "duration_opt_serde")]
    pub max_stale: Option<Duration>,
    #[serde(flatten, default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl ProviderConfig {
    pub fn validate(&self) -> RealIpResult<()> {
        match self.kind.as_str() {
            "inline" => {
                if self.cidrs.is_empty() {
                    return Err(RealIpError::MissingProviderField {
                        provider: self.name.clone(),
                        field: "cidrs",
                    });
                }
            }
            "local-file" => {
                if self.path.is_none() {
                    return Err(RealIpError::MissingProviderField {
                        provider: self.name.clone(),
                        field: "path",
                    });
                }
            }
            "remote-file" => {
                if self.url.is_none() {
                    return Err(RealIpError::MissingProviderField {
                        provider: self.name.clone(),
                        field: "url",
                    });
                }
            }
            "command" => {
                if self.command.is_none() {
                    return Err(RealIpError::MissingProviderField {
                        provider: self.name.clone(),
                        field: "command",
                    });
                }
            }
            kind => {
                return Err(RealIpError::UnknownProviderKind {
                    name: self.name.clone(),
                    kind: kind.to_string(),
                });
            }
        }

        Ok(())
    }
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

pub(crate) fn parse_duration_string(value: &str) -> Result<Duration, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("duration string cannot be empty".to_string());
    }

    let mut digits = String::new();
    let mut unit = String::new();
    for ch in trimmed.chars() {
        if ch.is_ascii_digit() && unit.is_empty() {
            digits.push(ch);
        } else {
            unit.push(ch);
        }
    }

    let amount: u64 = digits
        .parse()
        .map_err(|_| format!("invalid duration amount `{trimmed}`"))?;
    let duration = match unit.trim() {
        "ms" => Duration::from_millis(amount),
        "s" => Duration::from_secs(amount),
        "m" => Duration::from_secs(amount.saturating_mul(60)),
        "h" => Duration::from_secs(amount.saturating_mul(60 * 60)),
        "d" => Duration::from_secs(amount.saturating_mul(60 * 60 * 24)),
        other => return Err(format!("unsupported duration unit `{other}`")),
    };

    Ok(duration)
}

pub(crate) fn format_duration(duration: Duration) -> String {
    let secs = duration.as_secs();
    if secs > 0 && secs.is_multiple_of(60 * 60 * 24) {
        format!("{}d", secs / (60 * 60 * 24))
    } else if secs > 0 && secs.is_multiple_of(60 * 60) {
        format!("{}h", secs / (60 * 60))
    } else if secs > 0 && secs.is_multiple_of(60) {
        format!("{}m", secs / 60)
    } else if secs > 0 {
        format!("{}s", secs)
    } else {
        format!("{}ms", duration.as_millis())
    }
}

pub(crate) fn parse_ip_or_cidr(entry: &str) -> Result<IpNet, ()> {
    if let Ok(net) = entry.parse::<IpNet>() {
        return Ok(net);
    }
    let addr = entry.parse::<IpAddr>().map_err(|_| ())?;
    Ok(match addr {
        IpAddr::V4(ip) => IpNet::from(IpAddr::V4(ip)),
        IpAddr::V6(ip) => IpNet::from(IpAddr::V6(ip)),
    })
}

mod duration_opt_serde {
    use std::time::Duration;

    use serde::{Deserialize, Deserializer, Serializer};

    use crate::config::{format_duration, parse_duration_string};

    pub fn serialize<S>(value: &Option<Duration>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            Some(duration) => serializer.serialize_some(&format_duration(*duration)),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Duration>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Option::<String>::deserialize(deserializer)?;
        raw.map(|value| parse_duration_string(&value).map_err(serde::de::Error::custom))
            .transpose()
    }
}
