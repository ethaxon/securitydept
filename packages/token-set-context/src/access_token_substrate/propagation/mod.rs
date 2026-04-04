mod cidr;
mod config;
mod error;

use std::{
    collections::HashSet,
    fmt,
    net::IpAddr,
    str::FromStr,
    sync::{Arc, RwLock},
};

use cidr::{ParsedCidr, is_sensitive_ip_literal};
pub use config::{
    AllowedPropagationTarget, BearerPropagationPolicy, PropagatedTokenValidationConfig,
    PropagationDestinationPolicy, PropagationScheme, TokenPropagatorConfig,
};
pub use error::{TokenPropagatorError, TokenPropagatorResult};
use http::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use securitydept_oauth_resource_server::ResourceTokenPrincipal;
use url::Url;

pub const DEFAULT_PROPAGATION_HEADER_NAME: &str = "x-securitydept-propagation";

pub trait PropagationNodeTargetResolver: fmt::Debug + Send + Sync {
    fn resolve_url(&self, node_id: &str) -> Option<Url>;
}

/// Normalized downstream target context used during bearer propagation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropagationRequestTarget {
    /// Optional stable service identity resolved by the caller.
    pub node_id: Option<String>,
    /// Optional target URL scheme.
    pub scheme: Option<PropagationScheme>,
    /// Optional normalized target hostname without a trailing dot.
    pub hostname: Option<String>,
    /// Optional explicit target port.
    pub port: Option<u16>,
}

impl PropagationRequestTarget {
    pub fn new(
        node_id: Option<String>,
        scheme: PropagationScheme,
        hostname: impl Into<String>,
        port: impl Into<Option<u16>>,
    ) -> Self {
        Self {
            node_id,
            scheme: Some(scheme),
            hostname: Some(normalize_host(&hostname.into())),
            port: port.into(),
        }
    }

    pub fn for_node(node_id: impl Into<String>) -> Self {
        Self {
            node_id: Some(node_id.into()),
            scheme: None,
            hostname: None,
            port: None,
        }
    }

    pub fn from_url(node_id: Option<String>, url: &Url) -> TokenPropagatorResult<Self> {
        let scheme = parse_scheme(url.scheme())?;
        let hostname = url
            .host_str()
            .ok_or_else(|| TokenPropagatorError::InvalidTargetHost {
                host: String::new(),
            })?;
        let port = url.port();

        Ok(Self::new(node_id, scheme, hostname, port))
    }

    fn display(&self) -> String {
        match (&self.scheme, &self.hostname, self.port) {
            (Some(scheme), Some(hostname), Some(port)) => {
                format!("{}://{}:{port}", scheme.as_str(), hostname)
            }
            (Some(scheme), Some(hostname), None) => {
                format!(
                    "{}://{}:{}",
                    scheme.as_str(),
                    hostname,
                    scheme.default_port()
                )
            }
            (None, None, None) => self
                .node_id
                .as_ref()
                .map(|node_id| format!("node:{node_id}"))
                .unwrap_or_else(|| "incomplete-target".to_string()),
            _ => "incomplete-target".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedPropagationTarget {
    node_id: Option<String>,
    scheme: PropagationScheme,
    hostname: String,
    port: u16,
}

impl ResolvedPropagationTarget {
    fn display(&self) -> String {
        format!("{}://{}:{}", self.scheme.as_str(), self.hostname, self.port)
    }
}

/// Parsed value of `x-securitydept-propagation`.
///
/// The value format intentionally mirrors the parameter style of `Forwarded`,
/// for example:
///
/// `by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropagationDirective {
    pub by: Option<String>,
    pub r#for: Option<String>,
    pub hostname: String,
    pub port: Option<u16>,
    pub proto: PropagationScheme,
}

impl PropagationDirective {
    pub fn parse(value: &str) -> TokenPropagatorResult<Self> {
        let mut by = None;
        let mut for_identifier = None;
        let mut hostname = None;
        let mut port = None;
        let mut proto = None;

        for part in value.split(';') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }

            let Some((raw_key, raw_value)) = part.split_once('=') else {
                return Err(TokenPropagatorError::InvalidPropagationDirective {
                    message: format!("invalid propagation directive segment `{part}`"),
                });
            };
            let key = raw_key.trim().to_ascii_lowercase();
            let value = trim_quoted_value(raw_value.trim());

            match key.as_str() {
                "by" => by = Some(parse_directive_identifier("by", value)?),
                "for" => for_identifier = Some(parse_directive_identifier("for", value)?),
                "host" => {
                    let (parsed_hostname, parsed_port) = parse_directive_host(value)?;
                    hostname = Some(parsed_hostname);
                    port = parsed_port;
                }
                "proto" => proto = Some(parse_scheme(value)?),
                _ => {
                    return Err(TokenPropagatorError::InvalidPropagationDirective {
                        message: format!("unsupported propagation directive field `{key}`"),
                    });
                }
            }
        }

        let hostname =
            hostname.ok_or_else(|| TokenPropagatorError::InvalidPropagationDirective {
                message: "propagation directive requires `host`".to_string(),
            })?;
        let proto = proto.ok_or_else(|| TokenPropagatorError::InvalidPropagationDirective {
            message: "propagation directive requires `proto`".to_string(),
        })?;

        Ok(Self {
            by,
            r#for: for_identifier,
            hostname,
            port,
            proto,
        })
    }

    pub fn from_header_value(value: &HeaderValue) -> TokenPropagatorResult<Self> {
        let value =
            value
                .to_str()
                .map_err(|_| TokenPropagatorError::InvalidPropagationDirective {
                    message: "propagation header value must be valid ASCII".to_string(),
                })?;

        Self::parse(value)
    }

    pub fn to_header_value(&self) -> TokenPropagatorResult<HeaderValue> {
        let mut segments = Vec::new();

        if let Some(by) = &self.by {
            segments.push(format!("by={by}"));
        }
        if let Some(for_identifier) = &self.r#for {
            segments.push(format!("for={for_identifier}"));
        }
        let host = match self.port {
            Some(port) => format!("{}:{port}", self.hostname),
            None => self.hostname.clone(),
        };
        segments.push(format!("host={host}"));
        segments.push(format!("proto={}", self.proto.as_str()));

        HeaderValue::from_str(&segments.join(";"))
            .map_err(|source| TokenPropagatorError::InvalidHeaderValue { source })
    }

    pub fn to_request_target(&self) -> PropagationRequestTarget {
        PropagationRequestTarget::new(
            self.r#for.clone(),
            self.proto.clone(),
            self.hostname.clone(),
            self.port,
        )
    }
}

/// Runtime bearer material and access-token facts used during propagation.
#[derive(Debug, Clone, Copy)]
pub struct PropagatedBearer<'a> {
    pub access_token: &'a str,
    pub resource_token_principal: Option<&'a ResourceTokenPrincipal>,
}

impl<'a> PropagatedBearer<'a> {
    pub fn authorization_value(&self) -> String {
        format!("Bearer {}", self.access_token)
    }
}

#[derive(Debug, Clone)]
pub struct TokenPropagator {
    default_policy: BearerPropagationPolicy,
    destination_policy: PropagationDestinationPolicy,
    token_validation: PropagatedTokenValidationConfig,
    node_target_resolver: Arc<RwLock<Option<Arc<dyn PropagationNodeTargetResolver>>>>,
}

impl TokenPropagatorConfig {
    pub fn validate(&self) -> TokenPropagatorResult<()> {
        for target in &self.destination_policy.allowed_targets {
            match target {
                AllowedPropagationTarget::ExactOrigin { hostname, port, .. } => {
                    validate_host(hostname)?;
                    validate_port(*port)?;
                }
                AllowedPropagationTarget::DomainSuffix {
                    domain_suffix,
                    port,
                    ..
                } => {
                    let normalized = normalize_host(domain_suffix);
                    if normalized.is_empty() || normalized.parse::<IpAddr>().is_ok() {
                        return Err(TokenPropagatorError::PropagatorConfig {
                            message: format!(
                                "domain propagation target `{domain_suffix}` must be a non-IP \
                                 domain suffix"
                            ),
                        });
                    }
                    if normalized.contains('*') {
                        return Err(TokenPropagatorError::PropagatorConfig {
                            message: format!(
                                "domain propagation target `{domain_suffix}` must not contain \
                                 wildcards"
                            ),
                        });
                    }
                    validate_port(*port)?;
                }
                AllowedPropagationTarget::DomainRegex {
                    domain_regex, port, ..
                } => validate_domain_regex_target(domain_regex, *port)?,
                AllowedPropagationTarget::Cidr { cidr, port, .. } => {
                    if ParsedCidr::parse(cidr).is_none() {
                        return Err(TokenPropagatorError::InvalidCidr { cidr: cidr.clone() });
                    }
                    validate_port(*port)?;
                }
            }
        }

        Ok(())
    }
}

impl PropagationScheme {
    pub fn default_port(&self) -> u16 {
        match self {
            Self::Https => 443,
            Self::Http => 80,
        }
    }
}

impl TokenPropagator {
    pub fn from_config(config: &TokenPropagatorConfig) -> TokenPropagatorResult<Self> {
        Self::from_config_with_node_target_resolver(config, None)
    }

    pub fn from_config_with_node_target_resolver(
        config: &TokenPropagatorConfig,
        node_target_resolver: Option<Arc<dyn PropagationNodeTargetResolver>>,
    ) -> TokenPropagatorResult<Self> {
        config.validate()?;

        Ok(Self {
            default_policy: config.default_policy.clone(),
            destination_policy: config.destination_policy.clone(),
            token_validation: config.token_validation.clone(),
            node_target_resolver: Arc::new(RwLock::new(node_target_resolver)),
        })
    }

    pub fn policy(&self) -> &BearerPropagationPolicy {
        &self.default_policy
    }

    pub fn resolve_policy(&self) -> BearerPropagationPolicy {
        self.default_policy.clone()
    }

    pub fn set_node_target_resolver(
        &self,
        node_target_resolver: Option<Arc<dyn PropagationNodeTargetResolver>>,
    ) {
        let mut guard = self
            .node_target_resolver
            .write()
            .expect("node target resolver lock poisoned");
        *guard = node_target_resolver;
    }

    pub fn validate_target(
        &self,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
    ) -> TokenPropagatorResult<()> {
        self.validate_destination(target)?;
        self.validate_token(bearer)?;
        Ok(())
    }

    pub fn authorization_value(
        &self,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
    ) -> TokenPropagatorResult<String> {
        match self.resolve_policy() {
            BearerPropagationPolicy::ValidateThenForward => {
                self.validate_target(bearer, target)?;
                Ok(bearer.authorization_value())
            }
            BearerPropagationPolicy::ExchangeForDownstreamToken => {
                Err(TokenPropagatorError::UnsupportedDirectAuthorization {
                    policy: BearerPropagationPolicy::ExchangeForDownstreamToken,
                })
            }
        }
    }

    pub fn authorization_header_value(
        &self,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
    ) -> TokenPropagatorResult<HeaderValue> {
        let authorization_value = self.authorization_value(bearer, target)?;

        HeaderValue::from_str(&authorization_value)
            .map_err(|source| TokenPropagatorError::InvalidHeaderValue { source })
    }

    pub fn resolve_target_origin(
        &self,
        target: &PropagationRequestTarget,
    ) -> TokenPropagatorResult<String> {
        Ok(self.resolve_target(target)?.origin())
    }

    pub fn apply_authorization_header(
        &self,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
        headers: &mut HeaderMap,
    ) -> TokenPropagatorResult<()> {
        headers.insert(
            AUTHORIZATION,
            self.authorization_header_value(bearer, target)?,
        );
        Ok(())
    }

    fn validate_destination(&self, target: &PropagationRequestTarget) -> TokenPropagatorResult<()> {
        let target = self.resolve_target(target)?;
        validate_host(&target.hostname)?;
        validate_port(target.port)?;

        let matched_by_node = target.node_id.as_ref().is_some_and(|node_id| {
            self.destination_policy
                .allowed_node_ids
                .iter()
                .any(|allowed| allowed == node_id)
        });

        let host_ip = IpAddr::from_str(&target.hostname).ok();
        let matched_by_target = self
            .destination_policy
            .allowed_targets
            .iter()
            .any(|allowed_target| match_allowed_target(allowed_target, &target, host_ip));

        if !matched_by_node && !matched_by_target {
            return Err(TokenPropagatorError::DestinationNotAllowed {
                target: target.display(),
            });
        }

        if self.destination_policy.deny_sensitive_ip_literals
            && host_ip.is_some_and(is_sensitive_ip_literal)
            && !self
                .destination_policy
                .allowed_targets
                .iter()
                .any(|allowed_target| {
                    matches!(
                        allowed_target,
                        AllowedPropagationTarget::Cidr {
                            scheme,
                            port,
                            cidr,
                        } if scheme == &target.scheme
                            && port == &target.port
                            && ParsedCidr::parse(cidr)
                                .is_some_and(|parsed| parsed.contains(host_ip.expect("checked above")))
                    )
                })
        {
            return Err(TokenPropagatorError::SensitiveIpLiteralDenied {
                host: target.hostname.clone(),
            });
        }

        Ok(())
    }

    fn resolve_target(
        &self,
        target: &PropagationRequestTarget,
    ) -> TokenPropagatorResult<ResolvedPropagationTarget> {
        match (&target.node_id, &target.scheme, &target.hostname) {
            (node_id, Some(scheme), Some(hostname)) => Ok(ResolvedPropagationTarget {
                node_id: node_id.clone(),
                scheme: scheme.clone(),
                hostname: hostname.clone(),
                port: target.port.unwrap_or_else(|| scheme.default_port()),
            }),
            (Some(node_id), None, None) => {
                let resolver = self
                    .node_target_resolver
                    .read()
                    .expect("node target resolver lock poisoned")
                    .clone()
                    .ok_or_else(|| TokenPropagatorError::NodeTargetResolverRequired {
                        node_id: node_id.clone(),
                    })?;
                let url = resolver.resolve_url(node_id).ok_or_else(|| {
                    TokenPropagatorError::NodeTargetUnresolved {
                        node_id: node_id.clone(),
                    }
                })?;
                ResolvedPropagationTarget::from_url(Some(node_id.clone()), url)
            }
            _ => Err(TokenPropagatorError::IncompleteTarget {
                target: target.display(),
            }),
        }
    }

    fn validate_token(&self, bearer: &PropagatedBearer<'_>) -> TokenPropagatorResult<()> {
        let requires_token_facts = !self.token_validation.required_issuers.is_empty()
            || !self.token_validation.allowed_audiences.is_empty()
            || !self.token_validation.required_scopes.is_empty()
            || !self.token_validation.allowed_azp.is_empty();
        let resource_token_principal = bearer.resource_token_principal;

        if requires_token_facts && resource_token_principal.is_none() {
            return Err(TokenPropagatorError::TokenFactsUnavailable);
        }

        if !self.token_validation.required_issuers.is_empty() {
            let issuer = resource_token_principal
                .and_then(|principal| principal.issuer.clone())
                .unwrap_or_default();

            if !self
                .token_validation
                .required_issuers
                .iter()
                .any(|allowed| allowed == &issuer)
            {
                return Err(TokenPropagatorError::TokenIssuerNotAllowed { issuer });
            }
        }

        if !self.token_validation.allowed_audiences.is_empty() {
            let audiences: HashSet<String> = resource_token_principal
                .map(|principal| principal.audiences.iter().cloned().collect())
                .unwrap_or_default();
            let allowed_audiences: HashSet<String> = self
                .token_validation
                .allowed_audiences
                .iter()
                .cloned()
                .collect();

            if audiences.is_disjoint(&allowed_audiences) {
                return Err(TokenPropagatorError::TokenAudienceNotAllowed);
            }
        }

        if !self.token_validation.required_scopes.is_empty() {
            let scopes: HashSet<String> = resource_token_principal
                .map(|principal| principal.scopes.iter().cloned().collect())
                .unwrap_or_default();

            for required_scope in &self.token_validation.required_scopes {
                if !scopes.contains(required_scope) {
                    return Err(TokenPropagatorError::TokenScopeMissing {
                        scope: required_scope.clone(),
                    });
                }
            }
        }

        if !self.token_validation.allowed_azp.is_empty() {
            let azp = resource_token_principal
                .and_then(|principal| principal.authorized_party.as_deref())
                .unwrap_or_default()
                .to_string();

            if !self
                .token_validation
                .allowed_azp
                .iter()
                .any(|allowed| allowed == &azp)
            {
                return Err(TokenPropagatorError::TokenAzpNotAllowed { azp });
            }
        }

        Ok(())
    }
}

fn parse_scheme(scheme: &str) -> TokenPropagatorResult<PropagationScheme> {
    match scheme {
        "https" => Ok(PropagationScheme::Https),
        "http" => Ok(PropagationScheme::Http),
        _ => Err(TokenPropagatorError::UnsupportedTargetScheme {
            scheme: scheme.to_string(),
        }),
    }
}

fn validate_port(port: u16) -> TokenPropagatorResult<()> {
    if port == 0 {
        return Err(TokenPropagatorError::PropagatorConfig {
            message: "propagation targets must use a non-zero port".to_string(),
        });
    }

    Ok(())
}

fn validate_host(host: &str) -> TokenPropagatorResult<()> {
    let normalized = normalize_host(host);
    if normalized.is_empty() {
        return Err(TokenPropagatorError::InvalidTargetHost {
            host: host.to_string(),
        });
    }

    if normalized.parse::<IpAddr>().is_ok() {
        return Ok(());
    }

    if normalized
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '.' || ch == '-'))
    {
        return Err(TokenPropagatorError::InvalidTargetHost {
            host: host.to_string(),
        });
    }

    Ok(())
}

fn normalize_host(host: &str) -> String {
    host.trim().trim_end_matches('.').to_ascii_lowercase()
}

fn match_allowed_target(
    allowed_target: &AllowedPropagationTarget,
    target: &ResolvedPropagationTarget,
    host_ip: Option<IpAddr>,
) -> bool {
    match allowed_target {
        AllowedPropagationTarget::ExactOrigin {
            scheme,
            hostname,
            port,
        } => {
            scheme == &target.scheme
                && port == &target.port
                && normalize_host(hostname) == target.hostname
        }
        AllowedPropagationTarget::DomainSuffix {
            scheme,
            domain_suffix,
            port,
        } => {
            let suffix = normalize_host(domain_suffix);
            scheme == &target.scheme
                && port == &target.port
                && host_ip.is_none()
                && domain_suffix_matches(&target.hostname, &suffix)
        }
        AllowedPropagationTarget::DomainRegex {
            scheme,
            domain_regex,
            port,
        } => {
            scheme == &target.scheme
                && port == &target.port
                && host_ip.is_none()
                && domain_regex.is_match(&target.hostname)
        }
        AllowedPropagationTarget::Cidr { scheme, cidr, port } => {
            scheme == &target.scheme
                && port == &target.port
                && host_ip.is_some_and(|ip| {
                    ParsedCidr::parse(cidr).is_some_and(|parsed| parsed.contains(ip))
                })
        }
    }
}

fn domain_suffix_matches(host: &str, suffix: &str) -> bool {
    host == suffix || host.ends_with(&format!(".{suffix}"))
}

fn validate_domain_regex_target(
    domain_regex: &regex::Regex,
    port: u16,
) -> TokenPropagatorResult<()> {
    if domain_regex.as_str().is_empty() {
        return Err(TokenPropagatorError::PropagatorConfig {
            message: "domain regex propagation target must not be empty".to_string(),
        });
    }

    validate_port(port)
}

fn trim_quoted_value(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
}

fn parse_directive_identifier(field: &str, value: &str) -> TokenPropagatorResult<String> {
    if value.is_empty() {
        return Err(TokenPropagatorError::InvalidPropagationDirective {
            message: format!("propagation directive `{field}` must not be empty"),
        });
    }

    if value
        .chars()
        .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' || ch == ':'))
    {
        return Err(TokenPropagatorError::InvalidPropagationDirective {
            message: format!("propagation directive `{field}` contains unsupported characters"),
        });
    }

    Ok(value.to_string())
}

fn parse_directive_host(value: &str) -> TokenPropagatorResult<(String, Option<u16>)> {
    if value.is_empty() {
        return Err(TokenPropagatorError::InvalidPropagationDirective {
            message: "propagation directive `host` must not be empty".to_string(),
        });
    }

    if let Some(host) = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        validate_host(host)?;
        return Ok((normalize_host(host), None));
    }

    if let Some((host, port)) = value.rsplit_once(':')
        && !host.is_empty()
        && let Ok(port) = port.parse::<u16>()
    {
        validate_host(host)?;
        validate_port(port)?;
        return Ok((normalize_host(host), Some(port)));
    }

    validate_host(value)?;
    Ok((normalize_host(value), None))
}

impl ResolvedPropagationTarget {
    fn origin(&self) -> String {
        format!("{}://{}:{}", self.scheme.as_str(), self.hostname, self.port)
    }

    fn from_url(node_id: Option<String>, url: Url) -> TokenPropagatorResult<Self> {
        let target = PropagationRequestTarget::from_url(node_id, &url)?;
        let scheme =
            target
                .scheme
                .clone()
                .ok_or_else(|| TokenPropagatorError::IncompleteTarget {
                    target: target.display(),
                })?;
        let hostname =
            target
                .hostname
                .clone()
                .ok_or_else(|| TokenPropagatorError::IncompleteTarget {
                    target: target.display(),
                })?;

        Ok(Self {
            node_id: target.node_id,
            port: target.port.unwrap_or_else(|| scheme.default_port()),
            scheme,
            hostname,
        })
    }
}
