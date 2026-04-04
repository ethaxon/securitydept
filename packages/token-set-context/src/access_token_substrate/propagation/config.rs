use regex::Regex;
use serde::{Deserialize, Serialize};
use typed_builder::TypedBuilder;

/// Controls how a validated upstream bearer token may be propagated downstream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BearerPropagationPolicy {
    /// Forward the original bearer token only after destination and token
    /// checks pass.
    ValidateThenForward,
    /**
     * not implemented yet, planned for future
     * */
    /// Exchange the upstream token for a downstream-specific token before
    /// calling the target.
    ExchangeForDownstreamToken,
}

pub(crate) fn default_bearer_propagation_policy() -> BearerPropagationPolicy {
    BearerPropagationPolicy::ValidateThenForward
}

fn default_true() -> bool {
    true
}

/// Server-side token propagation configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct TokenPropagatorConfig {
    /// Default propagation policy applied by the server.
    #[builder(default = BearerPropagationPolicy::ValidateThenForward)]
    #[serde(default = "default_bearer_propagation_policy")]
    pub default_policy: BearerPropagationPolicy,
    /// Explicit destination allowlist for direct bearer forwarding.
    #[builder(default)]
    #[serde(default)]
    pub destination_policy: PropagationDestinationPolicy,
    /// Additional token claim checks required before forwarding.
    #[builder(default)]
    #[serde(default)]
    pub token_validation: PropagatedTokenValidationConfig,
}

impl Default for TokenPropagatorConfig {
    fn default() -> Self {
        Self {
            default_policy: default_bearer_propagation_policy(),
            destination_policy: PropagationDestinationPolicy::default(),
            token_validation: PropagatedTokenValidationConfig::default(),
        }
    }
}

/// Allowlist and safety guards for downstream targets.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default, TypedBuilder)]
pub struct PropagationDestinationPolicy {
    /// Stable service identities that may receive forwarded credentials.
    #[builder(default)]
    #[serde(default)]
    pub allowed_node_ids: Vec<String>,
    /// Explicit network targets that may receive forwarded credentials.
    #[builder(default)]
    #[serde(default)]
    pub allowed_targets: Vec<AllowedPropagationTarget>,
    /// Reject direct IP-literal targets for loopback/private/link-local style
    /// addresses unless they are explicitly allowed by a matching CIDR
    /// rule.
    #[builder(default = true)]
    #[serde(default = "default_true")]
    pub deny_sensitive_ip_literals: bool,
    /// Require callers that build targets from URLs to provide an explicit
    /// port.
    #[builder(default = true)]
    #[serde(default = "default_true")]
    pub require_explicit_port: bool,
}

/// Normalized scheme used for downstream propagation rules.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PropagationScheme {
    Https,
    Http,
}

impl PropagationScheme {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Https => "https",
            Self::Http => "http",
        }
    }
}

/// A single downstream target allowlist rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AllowedPropagationTarget {
    /// Match one exact origin tuple.
    ExactOrigin {
        scheme: PropagationScheme,
        hostname: String,
        port: u16,
    },
    /// Match one domain suffix such as `mesh.internal.example.com`.
    DomainSuffix {
        scheme: PropagationScheme,
        domain_suffix: String,
        port: u16,
    },
    /// Match domains with a compiled regex. Serialized with `serde_regex`.
    DomainRegex {
        scheme: PropagationScheme,
        #[serde(with = "serde_regex")]
        domain_regex: Regex,
        port: u16,
    },
    /// Match IP-literal targets inside the configured CIDR.
    Cidr {
        scheme: PropagationScheme,
        cidr: String,
        port: u16,
    },
}

impl PartialEq for AllowedPropagationTarget {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Self::ExactOrigin {
                    scheme: left_scheme,
                    hostname: left_hostname,
                    port: left_port,
                },
                Self::ExactOrigin {
                    scheme: right_scheme,
                    hostname: right_hostname,
                    port: right_port,
                },
            ) => {
                left_scheme == right_scheme
                    && left_hostname == right_hostname
                    && left_port == right_port
            }
            (
                Self::DomainSuffix {
                    scheme: left_scheme,
                    domain_suffix: left_suffix,
                    port: left_port,
                },
                Self::DomainSuffix {
                    scheme: right_scheme,
                    domain_suffix: right_suffix,
                    port: right_port,
                },
            ) => {
                left_scheme == right_scheme
                    && left_suffix == right_suffix
                    && left_port == right_port
            }
            (
                Self::DomainRegex {
                    scheme: left_scheme,
                    domain_regex: left_regex,
                    port: left_port,
                },
                Self::DomainRegex {
                    scheme: right_scheme,
                    domain_regex: right_regex,
                    port: right_port,
                },
            ) => {
                left_scheme == right_scheme
                    && left_regex.as_str() == right_regex.as_str()
                    && left_port == right_port
            }
            (
                Self::Cidr {
                    scheme: left_scheme,
                    cidr: left_cidr,
                    port: left_port,
                },
                Self::Cidr {
                    scheme: right_scheme,
                    cidr: right_cidr,
                    port: right_port,
                },
            ) => left_scheme == right_scheme && left_cidr == right_cidr && left_port == right_port,
            _ => false,
        }
    }
}

impl Eq for AllowedPropagationTarget {}

/// Additional token constraints evaluated before a bearer token may be
/// forwarded.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default, TypedBuilder)]
pub struct PropagatedTokenValidationConfig {
    /// Allowed issuers for the upstream token source.
    #[builder(default)]
    #[serde(default)]
    pub required_issuers: Vec<String>,
    /// At least one audience must match when this list is not empty.
    #[builder(default)]
    #[serde(default)]
    pub allowed_audiences: Vec<String>,
    /// Every listed scope must be present when this list is not empty.
    #[builder(default)]
    #[serde(default)]
    pub required_scopes: Vec<String>,
    /// Allowed authorized-party values when this list is not empty.
    #[builder(default)]
    #[serde(default)]
    pub allowed_azp: Vec<String>,
}
