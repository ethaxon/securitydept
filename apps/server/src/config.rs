use std::path::Path;

use figment::{
    Figment,
    providers::{Env, Format, Toml},
};
use securitydept_core::{
    basic_auth_context::{
        BasicAuthContextConfig, BasicAuthContextConfigSource,
        BasicAuthContextFixedPostAuthRedirectValidator,
        BasicAuthContextFixedSingleZonePathValidator,
        BasicAuthContextRejectZonePostAuthRedirectOverrideValidator, BasicAuthZoneConfig,
        ResolvedBasicAuthContextConfig,
    },
    creds::Argon2BasicAuthCred,
    creds_manage::CredsManageConfig,
    oidc::MokaPendingOauthStoreConfig,
    realip::RealIpResolveConfig,
    session_context::{
        ResolvedSessionContextConfig, SessionContextConfig, SessionContextConfigSource,
        SessionContextFixedPostAuthRedirectValidator,
    },
    token_set_context::{
        access_token_substrate::{
            AccessTokenSubstrateConfig, AccessTokenSubstrateConfigSource,
            ResolvedAccessTokenSubstrateConfig,
        },
        backend_oidc_mode::{
            BackendOidcModeConfigSource, BackendOidcModeConfigValidationError,
            BackendOidcModeConfigValidator, BackendOidcModeFixedRedirectUriValidator,
            BackendOidcModeRedirectUriConfig, MokaPendingAuthStateMetadataRedemptionConfig,
            PostAuthRedirectPolicy, ResolvedBackendOidcModeConfig,
        },
        cross_mode_config::{
            BackendOidcModeOverrideConfig, FrontendOidcModeOverrideConfig,
            TokenSetOidcSharedUnionConfig,
        },
        frontend_oidc_mode::{
            FrontendOidcModeConfigSource, FrontendOidcModeFixedRedirectUriValidator,
            ResolvedFrontendOidcModeConfig,
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

pub(crate) const TOKEN_SET_BACKEND_MODE_CALLBACK_PATH: &str =
    "/auth/token-set/backend-mode/callback";
pub(crate) const TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH: &str =
    "/auth/token-set/frontend-mode/callback";
pub(crate) const SESSION_AUTH_CALLBACK_PATH: &str = "/auth/session/callback";

#[derive(Debug, Clone)]
struct ServerBackendOidcFixedPostAuthRedirectValidator {
    fixed_post_auth_redirect: PostAuthRedirectPolicy,
}

impl ServerBackendOidcFixedPostAuthRedirectValidator {
    fn new(fixed_post_auth_redirect: PostAuthRedirectPolicy) -> Self {
        Self {
            fixed_post_auth_redirect,
        }
    }
}

impl BackendOidcModeConfigValidator for ServerBackendOidcFixedPostAuthRedirectValidator {
    fn validate_raw_backend_oidc_mode_config<PC, MC>(
        &self,
        config: &securitydept_core::token_set_context::backend_oidc_mode::BackendOidcModeConfig<
            PC,
            MC,
        >,
    ) -> Result<(), BackendOidcModeConfigValidationError>
    where
        PC: securitydept_core::oidc::PendingOauthStoreConfig,
        MC: securitydept_core::token_set_context::backend_oidc_mode::PendingAuthStateMetadataRedemptionConfig,
    {
        if !is_default_post_auth_redirect_policy(&config.post_auth_redirect)
            && !matches_fixed_post_auth_redirect_policy(
                &config.post_auth_redirect,
                &self.fixed_post_auth_redirect,
            )
        {
            return Err(BackendOidcModeConfigValidationError::new(
                "post_auth_redirect",
                "fixed_post_auth_redirect_conflict",
                "backend_oidc post_auth_redirect is fixed by the server and cannot be overridden",
            ));
        }

        Ok(())
    }
}

fn server_session_post_auth_redirect() -> RedirectTargetConfig {
    RedirectTargetConfig::dynamic_default_and_dynamic_targets(
        "/",
        [
            RedirectTargetRule::Strict {
                value: "/".to_string(),
            },
            RedirectTargetRule::Strict {
                value: "/playground/session".to_string(),
            },
        ],
    )
}

fn server_token_set_post_auth_redirect() -> PostAuthRedirectPolicy {
    PostAuthRedirectPolicy::Resolved {
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
    }
}

fn server_basic_auth_post_auth_redirect() -> RedirectTargetConfig {
    RedirectTargetConfig::dynamic_default_and_dynamic_targets(
        "/",
        [
            RedirectTargetRule::Strict {
                value: "/".to_string(),
            },
            RedirectTargetRule::Strict {
                value: "/playground/basic-auth".to_string(),
            },
        ],
    )
}

fn is_default_post_auth_redirect_policy(policy: &PostAuthRedirectPolicy) -> bool {
    matches!(policy, PostAuthRedirectPolicy::CallerValidated)
}

fn matches_fixed_post_auth_redirect_policy(
    actual: &PostAuthRedirectPolicy,
    expected: &PostAuthRedirectPolicy,
) -> bool {
    match (actual, expected) {
        (PostAuthRedirectPolicy::CallerValidated, PostAuthRedirectPolicy::CallerValidated) => true,
        (
            PostAuthRedirectPolicy::Resolved {
                config: actual_config,
            },
            PostAuthRedirectPolicy::Resolved {
                config: expected_config,
            },
        ) => actual_config == expected_config,
        _ => false,
    }
}

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

        config.validate()?;
        Ok(config)
    }

    pub fn resolved_session_context_config(&self) -> ServerResult<ResolvedSessionContextConfig> {
        let mut config = self.session_context.clone();
        let fixed_post_auth_redirect = server_session_post_auth_redirect();

        if config.post_auth_redirect == SessionContextConfig::default().post_auth_redirect {
            config.post_auth_redirect = fixed_post_auth_redirect.clone();
        }

        config
            .resolve_all_with_validator(&SessionContextFixedPostAuthRedirectValidator::new(
                fixed_post_auth_redirect,
            ))
            .map_err(|e| ServerError::InvalidConfig {
                message: e.to_string(),
            })
    }

    pub fn resolved_basic_auth_context_config(
        &self,
    ) -> ServerResult<ResolvedBasicAuthContextConfig<Argon2BasicAuthCred>> {
        let mut config = self.basic_auth_context.clone();
        if config.zones.is_empty() {
            config.zones.push(BasicAuthZoneConfig::default());
        }

        let fixed_post_auth_redirect = server_basic_auth_post_auth_redirect();
        if config.post_auth_redirect
            == BasicAuthContextConfig::<Argon2BasicAuthCred>::default().post_auth_redirect
        {
            config.post_auth_redirect = fixed_post_auth_redirect;
        }

        config
            .resolve_all_with_validator(&(
                BasicAuthContextFixedSingleZonePathValidator::new("/basic", "/login", "/logout"),
                BasicAuthContextFixedPostAuthRedirectValidator::new(
                    server_basic_auth_post_auth_redirect(),
                ),
                BasicAuthContextRejectZonePostAuthRedirectOverrideValidator,
            ))
            .map_err(|e| ServerError::InvalidConfig {
                message: e.to_string(),
            })
    }

    /// Resolve `[oidc]` shared defaults into validated backend-oidc config.
    ///
    /// Returns `None` when OIDC is disabled (no `[oidc]` section).
    ///
    /// Resolves only the OIDC mode sub-configs (oidc_client, runtime).
    /// [`resolve_substrate`](Self::resolve_substrate).
    pub fn resolve_oidc(&self) -> ServerResult<Option<ServerResolvedOidcModeConfig>> {
        let Some(ref shared) = self.oidc else {
            return Ok(None);
        };

        let mut backend_oidc = self
            .oidc_client_union
            .compose_backend_config(&self.backend_oidc_override);
        let fixed_redirect =
            BackendOidcModeFixedRedirectUriValidator::new(TOKEN_SET_BACKEND_MODE_CALLBACK_PATH);
        let fixed_post_auth_redirect = ServerBackendOidcFixedPostAuthRedirectValidator::new(
            server_token_set_post_auth_redirect(),
        );

        if is_default_post_auth_redirect_policy(&backend_oidc.post_auth_redirect) {
            backend_oidc.post_auth_redirect =
                fixed_post_auth_redirect.fixed_post_auth_redirect.clone();
        }

        let resolved = backend_oidc
            .resolve_all_with_validator(shared, &(&fixed_redirect, &fixed_post_auth_redirect))
            .map_err(|e| ServerError::InvalidConfig {
                message: format!("OIDC config resolution: {e}"),
            })?;

        let mut resolved = resolved;
        resolved.oidc_client.redirect_url = fixed_redirect.redirect_url().to_string();

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
        let fixed_redirect =
            FrontendOidcModeFixedRedirectUriValidator::new(TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH);

        let resolved = frontend_oidc
            .resolve_all_with_validator(shared, &fixed_redirect)
            .map_err(|e| ServerError::InvalidConfig {
                message: format!("frontend_oidc config resolution: {e}"),
            })?;

        let mut resolved = resolved;
        resolved.oidc_client.redirect_url = fixed_redirect.redirect_url().to_string();

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
        if self.basic_auth_context.real_ip_access.is_some() && self.real_ip_resolve.is_none() {
            return Err(ServerError::InvalidConfig {
                message: "server.real_ip_resolve is required when \
                          basic_auth_context.real_ip_access is configured"
                    .to_string(),
            });
        }
        self.resolved_session_context_config()?;
        self.resolved_basic_auth_context_config()?;
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
