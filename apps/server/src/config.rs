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
            BackendOidcModeConfigSource, BackendOidcModeRedirectUriConfig,
            MokaPendingAuthStateMetadataRedemptionConfig, PostAuthRedirectPolicy,
            ResolvedBackendOidcModeConfig,
        },
        cross_mode_config::{
            BackendOidcModeOverrideConfig, FrontendOidcModeOverrideConfig,
            TokenSetOidcSharedUnionConfig,
        },
        frontend_oidc_mode::{FrontendOidcModeConfigSource, ResolvedFrontendOidcModeConfig},
        orchestration::OidcSharedConfig,
    },
    utils::{
        base_url::ExternalBaseUrl,
        redirect::{RedirectTargetConfig, RedirectTargetRule},
    },
};
use serde::Deserialize;

use crate::error::{ServerError, ServerResult};

/// Concrete type alias for the server's shared OIDC-client union config.
type ServerOidcClientUnionConfig = TokenSetOidcSharedUnionConfig<
    MokaPendingOauthStoreConfig,
    MokaPendingAuthStateMetadataRedemptionConfig,
>;

/// Concrete type alias for the server's backend-oidc override config.
type ServerBackendOidcOverrideConfig = BackendOidcModeOverrideConfig<
    MokaPendingOauthStoreConfig,
    MokaPendingAuthStateMetadataRedemptionConfig,
>;

/// Concrete type alias for the server's frontend-oidc override config.
type ServerFrontendOidcOverrideConfig = FrontendOidcModeOverrideConfig;

/// Concrete type alias for the server's resolved backend-oidc config.
pub type ServerResolvedOidcModeConfig = ResolvedBackendOidcModeConfig<
    MokaPendingOauthStoreConfig,
    MokaPendingAuthStateMetadataRedemptionConfig,
>;

/// Concrete type alias for the server's resolved frontend-oidc config.
pub type ServerResolvedFrontendOidcModeConfig = ResolvedFrontendOidcModeConfig;

/// Top-level configuration loaded from TOML file + environment variables.
///
/// Priority (highest wins): env vars > TOML file > struct defaults.
///
/// Env var mapping uses `__` (double underscore) as the nesting separator:
///   SERVER__HOST              -> server.host
///   OIDC__CLIENT_ID           -> oidc.client_id
///   OIDC_CLIENT__PKCE_ENABLED           -> oidc_client.pkce_enabled
///   BACKEND_OIDC_OVERRIDE__PKCE_ENABLED -> backend_oidc_override.pkce_enabled
///   CREDS_MANAGE__DATA_PATH             -> creds_manage.data_path
///
/// # TOML structure
///
/// ```toml
/// [oidc]                      # shared provider defaults (well_known_url, client_id, …)
/// well_known_url = "…"
/// client_id      = "…"
///
/// [oidc_client]               # shared OIDC-client union config
/// pkce_enabled = true         # shared base before mode-specific overrides
///
/// [backend_oidc_override]     # optional backend-mode overrides
/// [frontend_oidc_override]    # optional frontend-mode overrides
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

    // -- Cross-mode shared union ([oidc_client] section) --
    /// Cross-mode shared OIDC config, read from the `[oidc_client]` TOML
    /// section.
    ///
    /// This crate-owned struct holds the shared OIDC-client intersection plus
    /// the full backend/frontend union surface. The server composes concrete
    /// backend/frontend configs from it instead of owning frontend inheritance
    /// policy locally.
    #[serde(rename = "oidc_client")]
    pub oidc_client_union: ServerOidcClientUnionConfig,

    // -- BackendOidcModeConfig override ([backend_oidc_override] section) --
    /// Backend OIDC mode override config, read from the
    /// `[backend_oidc_override]` TOML section.
    ///
    /// All fields are optional. The crate-level composer overlays this section
    /// on top of the shared `[oidc_client]` config, with subfield merge
    /// limited to the `OidcClientRawConfig`-like surface and whole-field
    /// replacement for non-client fields.
    #[serde(default, rename = "backend_oidc_override")]
    pub backend_oidc_override: ServerBackendOidcOverrideConfig,

    // -- FrontendOidcModeConfig override ([frontend_oidc_override] section) --
    /// Frontend OIDC mode override config, read from the
    /// `[frontend_oidc_override]` TOML section.
    ///
    /// All fields are optional. The crate-level composer overlays this section
    /// on top of the shared `[oidc_client]` config, with subfield merge
    /// limited to the `OidcClientRawConfig`-like surface and whole-field
    /// replacement for non-client fields.
    #[serde(default, rename = "frontend_oidc_override")]
    pub frontend_oidc_override: ServerFrontendOidcOverrideConfig,

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
        if config.oidc_client_union.oidc_client.redirect_url.is_some() {
            tracing::warn!(
                "oidc_client.redirect_url is set in config but has no effect for backend-mode: \
                 each auth context (session → /auth/session/callback, token-set backend mode → \
                 /auth/token-set/backend-mode/callback) uses a hardcoded redirect path. Remove \
                 this field to silence this warning."
            );
        }

        if config
            .backend_oidc_override
            .oidc_client
            .redirect_url
            .is_some()
        {
            tracing::warn!(
                "backend_oidc_override.redirect_url is set in config but has no effect: token-set \
                 backend mode uses a hardcoded callback path \
                 (/auth/token-set/backend-mode/callback). Remove this field to silence this \
                 warning."
            );
        }

        let server_session_redirect = RedirectTargetConfig::dynamic_default_and_dynamic_targets(
            "/",
            [
                RedirectTargetRule::Strict {
                    value: "/".to_string(),
                },
                RedirectTargetRule::Strict {
                    value: "/playground/session".to_string(),
                },
            ],
        );
        if config.session_context.post_auth_redirect != server_session_redirect {
            tracing::warn!(
                "session_context.post_auth_redirect is overridden to allowlist ['/', \
                 '/playground/session']; remove this section to silence this warning."
            );
            config.session_context.post_auth_redirect = server_session_redirect;
        }

        // post_auth_redirect is forced to a Resolved policy with a strict
        // allowlist. The SDK / login page supplies post_auth_redirect_uri
        // as a query parameter; the runtime validates it against:
        //   default: "/"  (dashboard)
        //   allowed: "/", "/playground/token-set/backend-mode"
        // Any other value falls back to "/".
        let server_token_set_redirect = PostAuthRedirectPolicy::Resolved {
            config: BackendOidcModeRedirectUriConfig::dynamic_default_and_dynamic_targets(
                "/",
                [
                    RedirectTargetRule::Strict {
                        value: "/".to_string(),
                    },
                    RedirectTargetRule::Strict {
                        value: "/playground/token-set/backend-mode".to_string(),
                    },
                ],
            ),
        };
        if !matches!(
            config.backend_oidc_override.post_auth_redirect,
            Some(PostAuthRedirectPolicy::Resolved { .. })
        ) {
            tracing::info!(
                "backend_oidc_override.post_auth_redirect overridden to Resolved policy with \
                 allowlist ['/', '/playground/token-set/backend-mode']"
            );
        }
        config.backend_oidc_override.post_auth_redirect = Some(server_token_set_redirect);

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

        // Hardcode basic_auth_context.post_auth_redirect to a narrow allowlist.
        // In the server+webui deployment, basic auth login may only return to
        // the dashboard root or the dedicated basic-auth playground.
        let server_basic_redirect = RedirectTargetConfig::dynamic_default_and_dynamic_targets(
            "/",
            [
                RedirectTargetRule::Strict {
                    value: "/".to_string(),
                },
                RedirectTargetRule::Strict {
                    value: "/playground/basic-auth".to_string(),
                },
            ],
        );
        if config.basic_auth_context.post_auth_redirect != server_basic_redirect {
            tracing::warn!(
                "basic_auth_context.post_auth_redirect is overridden to allowlist ['/', \
                 '/playground/basic-auth']: the server only redirects basic auth login to \
                 approved first-party pages. Remove this section to silence this warning."
            );
            config.basic_auth_context.post_auth_redirect = server_basic_redirect;
        }
        for zone in &mut config.basic_auth_context.zones {
            if zone.post_auth_redirect.is_some() {
                tracing::warn!(
                    "basic_auth_context.zones[].post_auth_redirect is ignored: the server uses \
                     the global allowlist ['/', '/playground/basic-auth'] for basic auth login."
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

        let backend_oidc = self
            .oidc_client_union
            .compose_backend_config(&self.backend_oidc_override);

        let resolved =
            backend_oidc
                .resolve_all(shared)
                .map_err(|e| ServerError::InvalidConfig {
                    message: format!("OIDC config resolution: {e}"),
                })?;

        Ok(Some(resolved))
    }

    /// Resolve `[oidc]` shared defaults into validated frontend-oidc config.
    ///
    /// Returns `None` when OIDC is disabled (no `[oidc]` section).
    pub fn resolve_frontend_oidc(
        &self,
    ) -> ServerResult<Option<ServerResolvedFrontendOidcModeConfig>> {
        let Some(ref shared) = self.oidc else {
            return Ok(None);
        };

        let frontend_oidc = self
            .oidc_client_union
            .compose_frontend_config(&self.frontend_oidc_override);

        let resolved =
            frontend_oidc
                .resolve_all(shared)
                .map_err(|e| ServerError::InvalidConfig {
                    message: format!("frontend_oidc config resolution: {e}"),
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
