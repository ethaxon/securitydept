use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use snafu::Snafu;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum TokenSetRedirectUriRule {
    Regex {
        #[serde(with = "serde_regex")]
        value: Regex,
    },
    All,
    Strict {
        value: String,
    },
}

impl PartialEq for TokenSetRedirectUriRule {
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

impl Eq for TokenSetRedirectUriRule {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenSetRedirectUriConfig {
    #[serde(default)]
    pub default_redirect_uri: Option<String>,
    #[serde(default)]
    pub dynamic_redirect_uri_enabled: bool,
    #[serde(default)]
    pub allowed_redirect_uris: Vec<TokenSetRedirectUriRule>,
    #[serde(default = "default_pending_redirect_ttl", with = "humantime_serde")]
    pub ttl: Duration,
    #[serde(default = "default_pending_redirect_max_capacity")]
    pub max_capacity: u64,
}

impl Default for TokenSetRedirectUriConfig {
    fn default() -> Self {
        Self {
            default_redirect_uri: None,
            dynamic_redirect_uri_enabled: false,
            allowed_redirect_uris: Vec::new(),
            ttl: default_pending_redirect_ttl(),
            max_capacity: default_pending_redirect_max_capacity(),
        }
    }
}

fn default_pending_redirect_ttl() -> Duration {
    Duration::from_secs(300)
}

fn default_pending_redirect_max_capacity() -> u64 {
    1000
}

#[derive(Debug, Snafu)]
pub enum TokenSetRedirectUriError {
    #[snafu(display("redirect uri is invalid: {message}"))]
    InvalidRedirectUri { message: String },
}

impl TokenSetRedirectUriConfig {
    pub fn validate(&self) -> Result<(), TokenSetRedirectUriError> {
        if let Some(default_redirect_uri) = self.default_redirect_uri.as_deref() {
            Url::parse(default_redirect_uri).map_err(|e| {
                TokenSetRedirectUriError::InvalidRedirectUri {
                    message: format!("default_redirect_uri is invalid: {e}"),
                }
            })?;
        }

        if self.dynamic_redirect_uri_enabled && self.allowed_redirect_uris.is_empty() {
            return Err(TokenSetRedirectUriError::InvalidRedirectUri {
                message: "allowed_redirect_uris is required when dynamic_redirect_uri_enabled is \
                          true"
                    .to_string(),
            });
        }

        for rule in &self.allowed_redirect_uris {
            if let TokenSetRedirectUriRule::Strict { value } = rule {
                Url::parse(value).map_err(|e| TokenSetRedirectUriError::InvalidRedirectUri {
                    message: format!("invalid strict redirect uri `{value}`: {e}"),
                })?;
            }
        }

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct TokenSetRedirectUriResolver {
    config: TokenSetRedirectUriConfig,
}

impl TokenSetRedirectUriResolver {
    pub fn from_config(config: TokenSetRedirectUriConfig) -> Self {
        Self { config }
    }

    pub fn resolve_redirect_uri(
        &self,
        requested_redirect_uri: Option<&str>,
    ) -> Result<Url, TokenSetRedirectUriError> {
        match requested_redirect_uri {
            Some(requested_redirect_uri) => {
                if !self.config.dynamic_redirect_uri_enabled {
                    return Err(TokenSetRedirectUriError::InvalidRedirectUri {
                        message: "dynamic redirect uri is disabled".to_string(),
                    });
                }

                let redirect_uri = Url::parse(requested_redirect_uri).map_err(|e| {
                    TokenSetRedirectUriError::InvalidRedirectUri {
                        message: format!("requested redirect_uri is invalid: {e}"),
                    }
                })?;

                if self
                    .config
                    .allowed_redirect_uris
                    .iter()
                    .any(|rule| Self::rule_matches(rule, redirect_uri.as_str()))
                {
                    Ok(redirect_uri)
                } else {
                    Err(TokenSetRedirectUriError::InvalidRedirectUri {
                        message: format!(
                            "requested redirect_uri `{}` is not allowed",
                            redirect_uri
                        ),
                    })
                }
            }
            None => self
                .config
                .default_redirect_uri
                .as_deref()
                .ok_or_else(|| TokenSetRedirectUriError::InvalidRedirectUri {
                    message: "redirect_uri is required when no default_redirect_uri is configured"
                        .to_string(),
                })
                .and_then(|value| {
                    Url::parse(value).map_err(|e| TokenSetRedirectUriError::InvalidRedirectUri {
                        message: format!("default_redirect_uri is invalid: {e}"),
                    })
                }),
        }
    }

    fn rule_matches(rule: &TokenSetRedirectUriRule, redirect_uri: &str) -> bool {
        match rule {
            TokenSetRedirectUriRule::All => true,
            TokenSetRedirectUriRule::Regex { value } => value.is_match(redirect_uri),
            TokenSetRedirectUriRule::Strict { value } => value == redirect_uri,
        }
    }
}
