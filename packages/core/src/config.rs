use std::path::Path;

use figment::Figment;
use figment::providers::{Env, Format, Toml};
use securitydept_oidc::OidcConfig;
use securitydept_utils::base_url::ExternalBaseUrl;
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
    #[serde(default)]
    pub external_base_url: ExternalBaseUrl,
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
    7021
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
        if let Some(ref oidc_config) = self.oidc {
            oidc_config.validate()?;
        };
        Ok(())
    }
}
