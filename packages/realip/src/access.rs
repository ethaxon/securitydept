use std::net::IpAddr;

use ipnet::IpNet;
use serde::{Deserialize, Serialize};

use crate::{
    error::{RealIpError, RealIpResult},
    resolve::{ResolvedClientIp, ResolvedSourceKind},
};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct RealIpAccessConfig {
    #[serde(default)]
    pub allowed_cidrs: Vec<IpNet>,
    #[serde(default)]
    pub allow_fallback: bool,
}

impl RealIpAccessConfig {
    pub fn validate(&self) -> RealIpResult<()> {
        if self.allowed_cidrs.is_empty() {
            return Err(RealIpError::AccessConfig {
                message: "allowed_cidrs must not be empty".to_string(),
            });
        }

        Ok(())
    }

    pub fn allows_client_ip(&self, client_ip: IpAddr) -> bool {
        self.allowed_cidrs
            .iter()
            .any(|cidr| cidr.contains(&client_ip))
    }
}

#[derive(Debug, Clone)]
pub struct RealIpAccessManager {
    config: RealIpAccessConfig,
}

impl RealIpAccessManager {
    pub fn from_config(config: RealIpAccessConfig) -> RealIpResult<Self> {
        config.validate()?;
        Ok(Self { config })
    }

    pub fn config(&self) -> &RealIpAccessConfig {
        &self.config
    }

    pub fn ensure_allowed(&self, resolved: &ResolvedClientIp) -> RealIpResult<()> {
        if resolved.source_kind == ResolvedSourceKind::Fallback && !self.config.allow_fallback {
            return Err(RealIpError::AccessDenied {
                client_ip: resolved.client_ip,
                reason: "fallback source is not allowed".to_string(),
            });
        }

        if !self.config.allows_client_ip(resolved.client_ip) {
            return Err(RealIpError::AccessDenied {
                client_ip: resolved.client_ip,
                reason: "client IP is not in allowed_cidrs".to_string(),
            });
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::*;

    #[test]
    fn access_config_requires_non_empty_allowed_cidrs() {
        let error = RealIpAccessManager::from_config(RealIpAccessConfig::default())
            .expect_err("empty allowed_cidrs should be rejected");

        assert!(matches!(error, RealIpError::AccessConfig { .. }));
    }

    #[test]
    fn access_manager_rejects_fallback_when_disabled() {
        let manager = RealIpAccessManager::from_config(RealIpAccessConfig {
            allowed_cidrs: vec!["10.0.0.0/8".parse().expect("cidr should parse")],
            allow_fallback: false,
        })
        .expect("access manager should build");
        let resolved = ResolvedClientIp {
            client_ip: IpAddr::V4(Ipv4Addr::new(10, 0, 0, 7)),
            peer_ip: IpAddr::V4(Ipv4Addr::new(10, 0, 0, 7)),
            source_name: None,
            source_kind: ResolvedSourceKind::Fallback,
            header_name: None,
        };

        let error = manager
            .ensure_allowed(&resolved)
            .expect_err("fallback should be rejected");

        assert!(matches!(error, RealIpError::AccessDenied { .. }));
    }
}
