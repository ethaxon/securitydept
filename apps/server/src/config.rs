use std::path::Path;

use figment::{
    Figment,
    providers::{Env, Format, Toml},
};
use securitydept_core::{
    basic_auth_context::{BasicAuthContextConfig, BasicAuthZoneConfig},
    creds::Argon2BasicAuthCred,
    creds_manage::CredsManageConfig,
    oidc::DefaultOidcClientConfig,
    realip::RealIpResolveConfig,
    session_context::SessionContextConfig,
    token_set_context::DefaultTokenSetContextConfig,
    utils::base_url::ExternalBaseUrl,
};
use serde::Deserialize;

use crate::error::{ServerError, ServerResult};

/// Top-level configuration loaded from TOML file + environment variables.
///
/// Priority (highest wins): env vars > TOML file > struct defaults.
///
/// Env var mapping uses `__` (double underscore) as the nesting separator:
///   SERVER__HOST  -> server.host
///   OIDC__CLIENT_ID -> oidc.client_id
///   CREDS_MANAGE__DATA_PATH -> creds_manage.data_path
#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default)]
    pub server: ServerCoreConfig,
    /// When absent (`None`), OIDC is disabled; /auth/session/login will create
    /// a dev session.
    #[serde(default)]
    pub oidc: Option<DefaultOidcClientConfig>,
    #[serde(default)]
    pub token_set_context: DefaultTokenSetContextConfig,
    #[serde(default)]
    pub session_context: SessionContextConfig,
    #[serde(default = "default_basic_auth_context")]
    pub basic_auth_context: BasicAuthContextConfig<Argon2BasicAuthCred>,
    #[serde(default)]
    pub real_ip_resolve: Option<RealIpResolveConfig>,
    #[serde(default)]
    pub creds_manage: CredsManageConfig,
}

impl ServerConfig {
    /// Load config: TOML file -> env vars (using `__` as nesting separator) ->
    /// validate.
    ///
    /// Set `OIDC_ENABLED=false` to force-disable OIDC regardless of config
    /// file.
    pub fn load(path: impl AsRef<Path>) -> ServerResult<Self> {
        let mut config: ServerConfig = Figment::new()
            .merge(Toml::file(path.as_ref()))
            .merge(Env::raw().split("__"))
            .extract()
            .map_err(|e| ServerError::ConfigLoad {
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

    fn validate(&self) -> ServerResult<()> {
        if let Some(ref oidc_config) = self.oidc {
            oidc_config.validate()?;
        }
        if self.basic_auth_context.zones.len() != 1 {
            return Err(ServerError::InvalidConfig {
                message: "server currently requires exactly one basic_auth_context zone"
                    .to_string(),
            });
        }
        if self.basic_auth_context.zones[0].zone_prefix != "/basic" {
            return Err(ServerError::InvalidConfig {
                message: "server currently requires basic_auth_context.zones[0].zone_prefix to be \
                          `/basic`"
                    .to_string(),
            });
        }
        if self.basic_auth_context.real_ip_access.is_some() && self.real_ip_resolve.is_none() {
            return Err(ServerError::InvalidConfig {
                message: "server.real_ip_resolve is required when \
                          basic_auth_context.real_ip_access is configured"
                    .to_string(),
            });
        }
        self.token_set_context
            .validate()
            .map_err(|e| ServerError::InvalidConfig {
                message: e.to_string(),
            })?;
        self.basic_auth_context
            .validate()
            .map_err(|e| ServerError::InvalidConfig {
                message: e.to_string(),
            })?;
        if let Some(real_ip) = &self.real_ip_resolve {
            real_ip.validate().map_err(|e| ServerError::InvalidConfig {
                message: e.to_string(),
            })?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ServerCoreConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// Optional path to the webui dist directory for serving static files.
    #[serde(default)]
    pub webui_dir: Option<String>,
    /// External base URL for generating absolute URLs (e.g. OIDC redirect).
    ///
    /// - `"auto"` (default): infer from request headers at runtime (Forwarded >
    ///   X-Forwarded-Host/Proto > Host > bind address).
    /// - Any other value: use as-is (e.g. `"https://auth.example.com"`).
    #[serde(default)]
    pub external_base_url: ExternalBaseUrl,
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    7021
}

fn default_basic_auth_context() -> BasicAuthContextConfig<Argon2BasicAuthCred> {
    BasicAuthContextConfig::builder()
        .zones(vec![BasicAuthZoneConfig::default()])
        .build()
}
