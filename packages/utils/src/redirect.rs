use iri_string::types::{UriReferenceString, UriRelativeString, UriString};
use regex::Regex;
use serde::{Deserialize, Serialize};
use snafu::Snafu;
use typed_builder::TypedBuilder;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum RedirectTargetRule {
    Regex {
        #[serde(with = "serde_regex")]
        value: Regex,
    },
    All,
    Strict {
        value: String,
    },
}

impl PartialEq for RedirectTargetRule {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::All, Self::All) => true,
            (Self::Strict { value: left }, Self::Strict { value: right }) => left == right,
            (Self::Regex { value: left }, Self::Regex { value: right }) => {
                left.as_str() == right.as_str()
            }
            _ => false,
        }
    }
}

impl Eq for RedirectTargetRule {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct RedirectTargetConfig {
    #[serde(default)]
    #[builder(default, setter(strip_option, into))]
    pub default_redirect_target: Option<String>,
    #[serde(default)]
    #[builder(default)]
    pub dynamic_redirect_target_enabled: bool,
    #[serde(default)]
    #[builder(default)]
    pub allowed_redirect_targets: Vec<RedirectTargetRule>,
}

impl RedirectTargetConfig {
    pub fn strict_default(redirect_target: impl Into<String>) -> Self {
        Self::builder()
            .default_redirect_target(redirect_target.into())
            .build()
    }

    pub fn dynamic_targets(targets: impl IntoIterator<Item = RedirectTargetRule>) -> Self {
        Self::builder()
            .dynamic_redirect_target_enabled(true)
            .allowed_redirect_targets(targets.into_iter().collect())
            .build()
    }

    pub fn dynamic_default_and_dynamic_targets(
        default_redirect_target: impl Into<String>,
        targets: impl IntoIterator<Item = RedirectTargetRule>,
    ) -> Self {
        Self::builder()
            .default_redirect_target(default_redirect_target.into())
            .dynamic_redirect_target_enabled(true)
            .allowed_redirect_targets(targets.into_iter().collect())
            .build()
    }

    pub fn validate_as_uri_reference(&self) -> Result<(), RedirectTargetError> {
        self.validate_with(parse_uri_reference, "URI reference")
    }

    pub fn validate_as_uri(&self) -> Result<(), RedirectTargetError> {
        self.validate_with(parse_uri, "URI")
    }

    pub fn validate_as_uri_relative(&self) -> Result<(), RedirectTargetError> {
        self.validate_with(parse_uri_relative, "relative URI reference")
    }

    fn validate_with<T>(
        &self,
        parse: fn(&str) -> Result<T, RedirectTargetError>,
        target_type: &str,
    ) -> Result<(), RedirectTargetError> {
        if let Some(default_redirect_target) = self.default_redirect_target.as_deref() {
            parse(default_redirect_target).map_err(|source| {
                RedirectTargetError::InvalidRedirectTarget {
                    message: format!(
                        "default_redirect_target is not a valid {target_type}: {source}"
                    ),
                }
            })?;
        }

        if self.dynamic_redirect_target_enabled && self.allowed_redirect_targets.is_empty() {
            return Err(RedirectTargetError::InvalidRedirectTarget {
                message: "allowed_redirect_targets is required when \
                          dynamic_redirect_target_enabled is true"
                    .to_string(),
            });
        }

        for rule in &self.allowed_redirect_targets {
            if let RedirectTargetRule::Strict { value } = rule {
                parse(value).map_err(|source| RedirectTargetError::InvalidRedirectTarget {
                    message: format!(
                        "invalid strict redirect target `{value}` for {target_type}: {source}"
                    ),
                })?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Snafu)]
pub enum RedirectTargetError {
    #[snafu(display("redirect target is invalid: {message}"))]
    InvalidRedirectTarget { message: String },
}

#[derive(Clone, Debug)]
pub struct UriReferenceRedirectTargetResolver {
    config: RedirectTargetConfig,
}

#[derive(Clone, Debug)]
pub struct UriRedirectTargetResolver {
    config: RedirectTargetConfig,
}

#[derive(Clone, Debug)]
pub struct UriRelativeRedirectTargetResolver {
    config: RedirectTargetConfig,
}

impl UriReferenceRedirectTargetResolver {
    pub fn from_config(config: RedirectTargetConfig) -> Result<Self, RedirectTargetError> {
        config.validate_as_uri_reference()?;
        Ok(Self { config })
    }

    pub fn resolve_redirect_target(
        &self,
        requested_redirect_target: Option<&str>,
    ) -> Result<UriReferenceString, RedirectTargetError> {
        resolve_with_config(&self.config, requested_redirect_target, parse_uri_reference)
    }
}

impl UriRedirectTargetResolver {
    pub fn from_config(config: RedirectTargetConfig) -> Result<Self, RedirectTargetError> {
        config.validate_as_uri()?;
        Ok(Self { config })
    }

    pub fn resolve_redirect_target(
        &self,
        requested_redirect_target: Option<&str>,
    ) -> Result<UriString, RedirectTargetError> {
        resolve_with_config(&self.config, requested_redirect_target, parse_uri)
    }
}

impl UriRelativeRedirectTargetResolver {
    pub fn from_config(config: RedirectTargetConfig) -> Result<Self, RedirectTargetError> {
        config.validate_as_uri_relative()?;
        Ok(Self { config })
    }

    pub fn resolve_redirect_target(
        &self,
        requested_redirect_target: Option<&str>,
    ) -> Result<UriRelativeString, RedirectTargetError> {
        resolve_with_config(&self.config, requested_redirect_target, parse_uri_relative)
    }
}

fn resolve_with_config<T>(
    config: &RedirectTargetConfig,
    requested_redirect_target: Option<&str>,
    parse: fn(&str) -> Result<T, RedirectTargetError>,
) -> Result<T, RedirectTargetError> {
    match requested_redirect_target {
        Some(requested_redirect_target) => {
            if !config.dynamic_redirect_target_enabled {
                return Err(RedirectTargetError::InvalidRedirectTarget {
                    message: "dynamic redirect target is disabled".to_string(),
                });
            }

            let parsed = parse(requested_redirect_target).map_err(|source| {
                RedirectTargetError::InvalidRedirectTarget {
                    message: format!("requested redirect target is invalid: {source}"),
                }
            })?;

            if config
                .allowed_redirect_targets
                .iter()
                .any(|rule| rule_matches(rule, requested_redirect_target))
            {
                Ok(parsed)
            } else {
                Err(RedirectTargetError::InvalidRedirectTarget {
                    message: format!(
                        "requested redirect target `{requested_redirect_target}` is not allowed"
                    ),
                })
            }
        }
        None => config
            .default_redirect_target
            .as_deref()
            .ok_or_else(|| RedirectTargetError::InvalidRedirectTarget {
                message: "redirect target is required when no default_redirect_target is \
                          configured"
                    .to_string(),
            })
            .and_then(parse),
    }
}

fn rule_matches(rule: &RedirectTargetRule, redirect_target: &str) -> bool {
    match rule {
        RedirectTargetRule::All => true,
        RedirectTargetRule::Regex { value } => value.is_match(redirect_target),
        RedirectTargetRule::Strict { value } => value == redirect_target,
    }
}

fn parse_uri_reference(value: &str) -> Result<UriReferenceString, RedirectTargetError> {
    UriReferenceString::try_from(value.to_string()).map_err(|e| {
        RedirectTargetError::InvalidRedirectTarget {
            message: e.to_string(),
        }
    })
}

fn parse_uri(value: &str) -> Result<UriString, RedirectTargetError> {
    UriString::try_from(value.to_string()).map_err(|e| RedirectTargetError::InvalidRedirectTarget {
        message: e.to_string(),
    })
}

fn parse_uri_relative(value: &str) -> Result<UriRelativeString, RedirectTargetError> {
    UriRelativeString::try_from(value.to_string()).map_err(|e| {
        RedirectTargetError::InvalidRedirectTarget {
            message: e.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use regex::Regex;

    use super::{
        RedirectTargetConfig, RedirectTargetRule, UriRedirectTargetResolver,
        UriReferenceRedirectTargetResolver, UriRelativeRedirectTargetResolver,
    };

    #[test]
    fn uri_config_rejects_relative_default() {
        let error = UriRedirectTargetResolver::from_config(RedirectTargetConfig {
            default_redirect_target: Some("/not-absolute".to_string()),
            dynamic_redirect_target_enabled: false,
            allowed_redirect_targets: Vec::new(),
        })
        .expect_err("relative path should be rejected");

        assert!(format!("{error}").contains("default_redirect_target is not a valid URI"));
    }

    #[test]
    fn uri_relative_config_rejects_absolute_default() {
        let error = UriRelativeRedirectTargetResolver::from_config(RedirectTargetConfig {
            default_redirect_target: Some("https://evil.example.com".to_string()),
            dynamic_redirect_target_enabled: false,
            allowed_redirect_targets: Vec::new(),
        })
        .expect_err("absolute uri should be rejected");

        assert!(format!("{error}").contains("relative URI reference"));
    }

    #[test]
    fn uri_relative_resolver_allows_strict_default() {
        let resolved = UriRelativeRedirectTargetResolver::from_config(
            RedirectTargetConfig::strict_default("/"),
        )
        .expect("config should be valid")
        .resolve_redirect_target(None)
        .expect("default target should resolve");

        assert_eq!(resolved.as_str(), "/");
    }

    #[test]
    fn uri_resolver_allows_regex_rule() {
        let resolved =
            UriRedirectTargetResolver::from_config(RedirectTargetConfig::dynamic_targets(vec![
                RedirectTargetRule::Regex {
                    value: Regex::new(r"^https://app\.example\.com/callback(/.*)?$")
                        .expect("regex should compile"),
                },
            ]))
            .expect("config should be valid")
            .resolve_redirect_target(Some("https://app.example.com/callback/a"))
            .expect("regex target should resolve");

        assert_eq!(resolved.as_str(), "https://app.example.com/callback/a");
    }

    #[test]
    fn uri_reference_resolver_allows_relative_and_absolute() {
        let resolver = UriReferenceRedirectTargetResolver::from_config(
            RedirectTargetConfig::dynamic_targets(vec![RedirectTargetRule::All]),
        )
        .expect("config should be valid");

        assert_eq!(
            resolver
                .resolve_redirect_target(Some("/foo"))
                .expect("relative reference should resolve")
                .as_str(),
            "/foo"
        );
        assert_eq!(
            resolver
                .resolve_redirect_target(Some("https://example.com/foo"))
                .expect("absolute reference should resolve")
                .as_str(),
            "https://example.com/foo"
        );
    }
}
