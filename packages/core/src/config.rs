use serde::Deserialize;
use snafu::ResultExt;
use std::path::Path;

use crate::error::{self, Result};

/// Top-level configuration loaded from TOML + env overrides.
#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub oidc: OidcConfig,
    #[serde(default)]
    pub data: DataConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// Secret used to sign session cookies.
    pub session_secret: String,
    /// Optional path to the webui dist directory for serving static files.
    #[serde(default)]
    pub webui_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OidcConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default = "default_redirect_uri")]
    pub redirect_uri: String,
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
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
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

fn default_data_path() -> String {
    "./data.json".to_string()
}

impl AppConfig {
    /// Load config from a TOML file, then apply environment variable overrides.
    pub async fn load(path: impl AsRef<Path>) -> Result<Self> {
        let content = tokio::fs::read_to_string(path.as_ref())
            .await
            .context(error::ConfigReadSnafu)?;

        let mut config: AppConfig =
            toml::from_str(&content).context(error::ConfigParseSnafu)?;

        // Apply env overrides for OIDC settings
        Self::apply_env_overrides(&mut config);

        config.validate()?;

        Ok(config)
    }

    fn apply_env_overrides(config: &mut AppConfig) {
        if let Ok(v) = std::env::var("OIDC_CLIENT_ID") {
            config.oidc.client_id = v;
        }
        if let Ok(v) = std::env::var("OIDC_CLIENT_SECRET") {
            config.oidc.client_secret = Some(v);
        }
        if let Ok(v) = std::env::var("OIDC_REDIRECT_URI") {
            config.oidc.redirect_uri = v;
        }
        if let Ok(v) = std::env::var("OIDC_WELL_KNOWN_URL") {
            config.oidc.well_known_url = Some(v);
        }
        if let Ok(v) = std::env::var("OIDC_AUTHORIZATION_ENDPOINT") {
            config.oidc.authorization_endpoint = Some(v);
        }
        if let Ok(v) = std::env::var("OIDC_TOKEN_ENDPOINT") {
            config.oidc.token_endpoint = Some(v);
        }
        if let Ok(v) = std::env::var("OIDC_USERINFO_ENDPOINT") {
            config.oidc.userinfo_endpoint = Some(v);
        }
        if let Ok(v) = std::env::var("OIDC_JWKS_URI") {
            config.oidc.jwks_uri = Some(v);
        }
        if let Ok(v) = std::env::var("OIDC_SCOPES") {
            config.oidc.scopes = v.split_whitespace().map(String::from).collect();
        }
        if let Ok(v) = std::env::var("OIDC_CHECK_SCRIPTS") {
            config.oidc.claims_check_script = Some(v);
        }
    }

    fn validate(&self) -> Result<()> {
        if self.oidc.well_known_url.is_none()
            && (self.oidc.authorization_endpoint.is_none() || self.oidc.token_endpoint.is_none())
        {
            return Err(error::Error::InvalidConfig {
                message: "Either well_known_url or both authorization_endpoint and token_endpoint must be set".to_string(),
            });
        }
        Ok(())
    }
}
