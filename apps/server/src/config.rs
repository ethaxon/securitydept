use std::path::Path;

use figment::{
    Figment,
    providers::{Env, Format, Toml},
};
use securitydept_core::{
    basic_auth_context::{BasicAuthContextConfig, BasicAuthZoneConfig},
    creds::Argon2BasicAuthCred,
    creds_manage::CredsManageConfig,
    oidc::MokaPendingOauthStoreConfig,
    realip::RealIpResolveConfig,
    session_context::SessionContextConfig,
    token_set_context::{
        access_token_substrate::{
            AccessTokenSubstrateConfig, AccessTokenSubstrateConfigSource,
            ResolvedAccessTokenSubstrateConfig,
        },
        backend_oidc_mode::{
            BackendOidcModeConfig, BackendOidcModeConfigSource, BackendOidcModeRedirectUriConfig,
            MokaPendingAuthStateMetadataRedemptionConfig, PostAuthRedirectPolicy,
            ResolvedBackendOidcModeConfig,
        },
        orchestration::OidcSharedConfig,
    },
    utils::{
        base_url::ExternalBaseUrl,
        redirect::{RedirectTargetConfig, RedirectTargetRule},
    },
};
use serde::Deserialize;

use crate::error::{ServerError, ServerResult};

/// Concrete type alias for the server's backend-oidc config.
type ServerOidcModeConfig = BackendOidcModeConfig<
    MokaPendingOauthStoreConfig,
    MokaPendingAuthStateMetadataRedemptionConfig,
>;

/// Concrete type alias for the server's resolved backend-oidc config.
pub type ServerResolvedOidcModeConfig = ResolvedBackendOidcModeConfig<
    MokaPendingOauthStoreConfig,
    MokaPendingAuthStateMetadataRedemptionConfig,
>;

/// Top-level configuration loaded from TOML file + environment variables.
///
/// Priority (highest wins): env vars > TOML file > struct defaults.
///
/// Env var mapping uses `__` (double underscore) as the nesting separator:
///   SERVER__HOST              -> server.host
///   OIDC__CLIENT_ID           -> oidc.client_id
///   OIDC_CLIENT__PKCE_ENABLED -> oidc_client.pkce_enabled
///   CREDS_MANAGE__DATA_PATH   -> creds_manage.data_path
///
/// # TOML structure
///
/// ```toml
/// [oidc]                      # shared provider defaults (well_known_url, client_id, …)
/// well_known_url = "…"
/// client_id      = "…"
///
/// [oidc_client]               # BackendOidcModeConfig — client overrides + runtime capabilities
/// pkce_enabled   = true       # (inherits [oidc] shared defaults via resolve_oidc)
///
/// [oauth_resource_server]     # AccessTokenSubstrateConfig — resource-server + propagation
/// audiences = ["api://…"]     # (inherits [oidc] shared defaults via resolve_substrate)
/// ```
///
/// # Resolution
///
/// Raw TOML values are not used directly. Call
/// [`resolve_oidc`](Self::resolve_oidc)
/// and [`resolve_substrate`](Self::resolve_substrate) at startup to apply
/// `[oidc]` shared defaults and validate both sub-configs.
#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default)]
    pub server: ServerCoreConfig,

    // -- OIDC shared defaults --
    /// Shared OIDC provider defaults. When absent (`None`), OIDC is disabled;
    /// `/auth/session/login` will create a dev session.
    #[serde(default, rename = "oidc")]
    pub oidc: Option<OidcSharedConfig>,

    // -- BackendOidcModeConfig ([oidc_client] section) --
    /// Backend OIDC mode config, read from the `[oidc_client]` TOML section.
    ///
    /// Contains OIDC client overrides and runtime capability axes
    /// (`refresh_material_protection`, `metadata_delivery`,
    /// `post_auth_redirect`). Call [`resolve_oidc`](Self::resolve_oidc) to
    /// apply `[oidc]` shared defaults and validate.
    #[serde(rename = "oidc_client")]
    pub backend_oidc: ServerOidcModeConfig,

    // -- AccessTokenSubstrateConfig ([oauth_resource_server] section) --
    /// Access-token substrate config, read from the `[oauth_resource_server]`
    /// TOML section.
    ///
    /// Contains resource-server verification config and token-propagation
    /// policy. Call [`resolve_substrate`](Self::resolve_substrate) to apply
    /// `[oidc]` shared defaults and validate.
    #[serde(rename = "oauth_resource_server")]
    pub access_token_substrate: AccessTokenSubstrateConfig,

    // -- Server-specific (not in BackendOidcModeConfig) --
    // -- Independent auth contexts --
    #[serde(default)]
    pub session_context: SessionContextConfig,
    #[serde(default = "default_basic_auth_context")]
    pub basic_auth_context: BasicAuthContextConfig<Argon2BasicAuthCred>,
    #[serde(default)]
    pub real_ip_resolve: Option<RealIpResolveConfig>,

    // -- Infra --
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

        // Warn when redirect_url is set — each auth context (session, token-set)
        // hardcodes its own callback path via redirect_url_override at runtime, so
        // this field has no effect and will be silently ignored.
        if config.backend_oidc.oidc_client.redirect_url.is_some() {
            tracing::warn!(
                "oidc_client.redirect_url is set in config but has no effect: each auth context \
                 (session → /auth/session/callback, token-set → /auth/token-set/callback) uses a \
                 hardcoded redirect path. Remove this field to silence this warning."
            );
        }

        // post_auth_redirect is forced to a Resolved policy with a strict
        // allowlist. The SDK / login page supplies post_auth_redirect_uri
        // as a query parameter; the runtime validates it against:
        //   default: "/"  (dashboard)
        //   allowed: "/", "/playground/token-set"
        // Any other value falls back to "/".
        let server_token_set_redirect = PostAuthRedirectPolicy::Resolved {
            config: BackendOidcModeRedirectUriConfig::dynamic_default_and_dynamic_targets(
                "/",
                [
                    RedirectTargetRule::Strict {
                        value: "/".to_string(),
                    },
                    RedirectTargetRule::Strict {
                        value: "/playground/token-set".to_string(),
                    },
                ],
            ),
        };
        if !matches!(
            config.backend_oidc.post_auth_redirect,
            PostAuthRedirectPolicy::Resolved { .. }
        ) {
            tracing::info!(
                "oidc_client.post_auth_redirect overridden to Resolved policy with allowlist \
                 ['/', '/playground/token-set']"
            );
        }
        config.backend_oidc.post_auth_redirect = server_token_set_redirect;

        if config.basic_auth_context.zones.is_empty() {
            config
                .basic_auth_context
                .zones
                .push(BasicAuthZoneConfig::default());
        }

        if config.basic_auth_context.zones.len() == 1 {
            let zone = &mut config.basic_auth_context.zones[0];
            let default_zone = BasicAuthZoneConfig::default();
            if zone.zone_prefix != default_zone.zone_prefix
                || zone.login_subpath != default_zone.login_subpath
                || zone.logout_subpath != default_zone.logout_subpath
            {
                tracing::warn!(
                    "basic_auth_context.zones[0] paths are fixed to: prefix='{}', login='{}', \
                     logout='{}'; overriding user config",
                    default_zone.zone_prefix,
                    default_zone.login_subpath,
                    default_zone.logout_subpath
                );
                zone.zone_prefix = default_zone.zone_prefix;
                zone.login_subpath = default_zone.login_subpath;
                zone.logout_subpath = default_zone.logout_subpath;
            }
        }

        // Hardcode basic_auth_context.post_auth_redirect to strict "/".
        // In the server+webui deployment, basic auth login always returns to
        // the dashboard root. Allowing user-supplied or query-param-driven
        // redirects would create an open-redirect vector.
        let server_basic_redirect = RedirectTargetConfig::strict_default("/");
        if config.basic_auth_context.post_auth_redirect != server_basic_redirect {
            tracing::warn!(
                "basic_auth_context.post_auth_redirect is overridden to strict '/': the server \
                 always redirects to the dashboard root after basic auth login. Remove this \
                 section to silence this warning."
            );
            config.basic_auth_context.post_auth_redirect = server_basic_redirect;
        }
        for zone in &mut config.basic_auth_context.zones {
            if zone.post_auth_redirect.is_some() {
                tracing::warn!(
                    "basic_auth_context.zones[].post_auth_redirect is ignored: the server always \
                     redirects to '/' after basic auth login."
                );
                zone.post_auth_redirect = None;
            }
        }

        config.validate()?;
        Ok(config)
    }

    /// Resolve `[oidc]` shared defaults into validated backend-oidc config.
    ///
    /// Returns `None` when OIDC is disabled (no `[oidc]` section).
    ///
    /// Resolves only the OIDC mode sub-configs (oidc_client, runtime).
    /// Resource-server resolution is handled separately by
    /// [`resolve_substrate`](Self::resolve_substrate).
    pub fn resolve_oidc(&self) -> ServerResult<Option<ServerResolvedOidcModeConfig>> {
        let Some(ref shared) = self.oidc else {
            return Ok(None);
        };

        let resolved =
            self.backend_oidc
                .resolve_all(shared)
                .map_err(|e| ServerError::InvalidConfig {
                    message: format!("OIDC config resolution: {e}"),
                })?;

        Ok(Some(resolved))
    }

    /// Resolve `[oidc]` shared defaults into the access-token substrate config.
    ///
    /// Applies OIDC provider defaults (well_known_url, client_id,
    /// client_secret) to `substrate.resource_server` so that introspection
    /// can inherit from the shared `[oidc]` block.
    ///
    /// When OIDC is disabled (`None`), resource-server config is returned
    /// unchanged (valid when no resource-server verification is needed).
    ///
    /// Delegates to [`AccessTokenSubstrateConfigSource::resolve_all`].
    pub fn resolve_substrate(&self) -> ServerResult<ResolvedAccessTokenSubstrateConfig> {
        self.access_token_substrate
            .resolve_all(self.oidc.as_ref())
            .map_err(|e| ServerError::InvalidConfig {
                message: format!("access_token_substrate config: {e}"),
            })
    }

    fn validate(&self) -> ServerResult<()> {
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
        // runtime validation (including token_propagation) is deferred to
        // resolve_oidc() which calls BackendOidcModeConfigSource::resolve_all().
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
