use std::path::Path;

use figment::Figment;
use figment::providers::{Env, Format, Toml};
use openidconnect::core::{CoreClientAuthMethod, CoreJwsSigningAlgorithm};
use serde::Deserialize;
use serde_with::{DeserializeAs, NoneAsEmptyString, PickFirst, serde_as};

/// Deserializes a string into Vec<T> by splitting on comma and/or whitespace.
/// Used with PickFirst to accept either a delimited string or a sequence (array).
pub struct CommaOrSpaceSeparated<T>(std::marker::PhantomData<T>);

impl<'de, T> DeserializeAs<'de, Vec<T>> for CommaOrSpaceSeparated<T>
where
    T: serde::de::DeserializeOwned,
{
    fn deserialize_as<D>(deserializer: D) -> std::result::Result<Vec<T>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.split(|c: char| c == ',' || c.is_whitespace())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|part| {
                let quoted =
                    serde_json::to_string(part).map_err(<D::Error as serde::de::Error>::custom)?;
                serde_json::from_str::<T>(&quoted).map_err(<D::Error as serde::de::Error>::custom)
            })
            .collect()
    }
}

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

#[serde_as]
#[derive(Debug, Clone, Deserialize)]
pub struct OidcConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    /// When well_known_url is set, discovery is fetched from it
    /// and optional metadata values below override discovered values.
    /// Discovery document URL. If unset, metadata values must all be set.
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub well_known_url: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub issuer_url: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub authorization_endpoint: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub token_endpoint: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub userinfo_endpoint: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub jwks_uri: Option<String>,
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreClientAuthMethod>, _)>>")]
    #[serde(default)]
    pub token_endpoint_auth_methods_supported: Option<Vec<CoreClientAuthMethod>>,
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreJwsSigningAlgorithm>, _)>>")]
    #[serde(default)]
    pub id_token_signing_alg_values_supported: Option<Vec<CoreJwsSigningAlgorithm>>,
    /// Supported userinfo signing algorithms; may include "none" for unsigned response.
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreJwsSigningAlgorithm>, _)>>")]
    #[serde(default)]
    pub userinfo_signing_alg_values_supported: Option<Vec<CoreJwsSigningAlgorithm>>,
    #[serde(default)]
    pub claims_check_script: Option<String>,
    /// When true, use PKCE (code_challenge / code_verifier) for the authorization code flow.
    #[serde(default)]
    pub pkce_enabled: bool,
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

pub(crate) fn default_id_token_signing_alg_values_supported() -> Vec<CoreJwsSigningAlgorithm> {
    vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256]
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
        if oidc.well_known_url.is_none() {
            let missing: Vec<&str> = [
                ("issuer_url", oidc.issuer_url.as_deref()),
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
                        "When well_known_url is not set, all of issuer_url, authorization_endpoint, token_endpoint, userinfo_endpoint and jwks_uri must be set; missing: {}",
                        missing.join(", ")
                    ),
                });
            }
        }
        Ok(())
    }
}
