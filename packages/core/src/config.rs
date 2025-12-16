use std::path::Path;

use figment::Figment;
use figment::providers::{Env, Format, Toml};
use openidconnect::core::CoreJwsSigningAlgorithm;
use serde::Deserialize;

use crate::error::{self, Result};

/// Top-level configuration loaded from TOML file + environment variables.
///
/// Priority (highest wins): env vars > TOML file > struct defaults.
///
/// Env var mapping uses `__` (double underscore) as the nesting separator:
///   SERVER__HOST  -> server.host
///   OIDC__CLIENT_ID -> oidc.client_id
///   DATA__PATH -> data.path
#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    /// When absent (`None`), OIDC is disabled; /auth/login will create a dev session.
    #[serde(default)]
    pub oidc: Option<OidcConfig>,
    #[serde(default)]
    pub data: DataConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// Optional path to the webui dist directory for serving static files.
    #[serde(default)]
    pub webui_dir: Option<String>,
    /// External base URL for generating absolute URLs (e.g. OIDC redirect).
    ///
    /// - `"auto"` (default): infer from request headers at runtime
    ///   (Forwarded > X-Forwarded-Host/Proto > Host > bind address).
    /// - Any other value: use as-is (e.g. `"https://auth.example.com"`).
    #[serde(default = "default_external_base_url")]
    pub external_base_url: String,
}

/// Parsed representation of the `external_base_url` config value.
#[derive(Debug, Clone)]
pub enum ExternalBaseUrl {
    /// Infer from request headers at runtime.
    Auto,
    /// Use this fixed URL.
    Fixed(String),
}

impl ExternalBaseUrl {
    pub fn from_config(value: &str) -> Self {
        if value.eq_ignore_ascii_case("auto") {
            Self::Auto
        } else {
            Self::Fixed(value.trim_end_matches('/').to_string())
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct OidcConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default = "default_redirect_uri")]
    pub redirect_uri: String,
    /// OIDC issuer URL (required). When well_known_url is set, discovery is fetched from it
    /// and optional endpoint URLs below override discovered values.
    pub issuer_url: String,
    /// Discovery document URL. If unset, authorization_endpoint, token_endpoint,
    /// userinfo_endpoint and jwks_uri must all be set.
    #[serde(default)]
    pub well_known_url: Option<String>,
    #[serde(default)]
    pub authorization_endpoint: Option<String>,
    #[serde(default)]
    pub token_endpoint: Option<String>,
    #[serde(default)]
    pub userinfo_endpoint: Option<String>,
    #[serde(default)]
    pub jwks_uri: Option<String>,
    #[serde(default)]
    pub token_endpoint_auth_methods_supported: Vec<String>,
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub id_token_signed_response_alg: Option<CoreJwsSigningAlgorithm>,
    #[serde(default)]
    pub userinfo_signed_response_alg: Option<CoreJwsSigningAlgorithm>,
    #[serde(default)]
    pub claims_check_script: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DataConfig {
    #[serde(default = "default_data_path")]
    pub path: String,
}

impl Default for DataConfig {
    fn default() -> Self {
        Self {
            path: default_data_path(),
        }
    }
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    8080
}

fn default_redirect_uri() -> String {
    "/auth/callback".to_string()
}

fn default_scopes() -> Vec<String> {
    vec![
        "openid".to_string(),
        "profile".to_string(),
        "email".to_string(),
    ]
}

fn default_external_base_url() -> String {
    "auto".to_string()
}

fn default_data_path() -> String {
    "./data/data.json".to_string()
}

impl AppConfig {
    /// Load config: TOML file -> env vars (using `__` as nesting separator) -> validate.
    ///
    /// Set `OIDC_ENABLED=false` to force-disable OIDC regardless of config file.
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let mut config: AppConfig = Figment::new()
            .merge(Toml::file(path.as_ref()))
            .merge(Env::raw().split("__"))
            .extract()
            .map_err(|e| error::Error::ConfigLoad {
                message: e.to_string(),
            })?;

        // Special meta env var: OIDC_ENABLED=false removes the oidc section entirely
        if let Ok(v) = std::env::var("OIDC_ENABLED")
            && (v.eq_ignore_ascii_case("false") || v == "0")
        {
            config.oidc = None;
        }

        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<()> {
        let Some(ref oidc) = self.oidc else {
            return Ok(());
        };
        if oidc.issuer_url.trim().is_empty() {
            return Err(error::Error::InvalidConfig {
                message: "oidc.issuer_url is required".to_string(),
            });
        }
        if oidc.well_known_url.is_none() {
            let missing: Vec<&str> = [
                (
                    "authorization_endpoint",
                    oidc.authorization_endpoint.as_deref(),
                ),
                ("token_endpoint", oidc.token_endpoint.as_deref()),
                ("userinfo_endpoint", oidc.userinfo_endpoint.as_deref()),
                ("jwks_uri", oidc.jwks_uri.as_deref()),
            ]
            .into_iter()
            .filter_map(|(name, v)| match v {
                None | Some("") => Some(name),
                Some(s) if s.trim().is_empty() => Some(name),
                _ => None,
            })
            .collect();
            if !missing.is_empty() {
                return Err(error::Error::InvalidConfig {
                    message: format!(
                        "When well_known_url is not set, all of authorization_endpoint, token_endpoint, userinfo_endpoint and jwks_uri must be set; missing: {}",
                        missing.join(", ")
                    ),
                });
            }
        }
        Ok(())
    }
}
