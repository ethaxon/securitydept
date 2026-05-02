use std::{net::SocketAddr, sync::Arc};

use axum::http::HeaderMap;
pub use securitydept_core::oidc::MokaPendingOauthStore;
use securitydept_core::{
    basic_auth_context::{BasicAuthContext, BasicAuthContextService},
    creds::Argon2BasicAuthCred,
    creds_manage::store::CredsManageStore,
    oidc::{OidcClient, OidcError},
    realip::{RealIpResolver, ResolvedClientIp, TransportContext},
    session_context::{
        OidcSessionAuthService, OidcSessionAuthServiceConfig, ResolvedSessionContextConfig,
    },
    token_set_context::{
        access_token_substrate::{
            AccessTokenSubstrateResourceService, AccessTokenSubstrateRuntime,
            AxumReverseProxyPropagationForwarder, OAuthResourceServerVerifier,
        },
        backend_oidc_mode::{
            BackendOidcModeAuthService, BackendOidcModeRuntime,
            MokaPendingAuthStateMetadataRedemptionStore,
        },
        frontend_oidc_mode::{FrontendOidcModeRuntime, FrontendOidcModeService},
    },
};
use url::Url;

use crate::{
    config::{SESSION_AUTH_CALLBACK_PATH, ServerConfig, TOKEN_SET_BACKEND_MODE_CALLBACK_PATH},
    error::{ServerError, ServerResult},
};

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct ServerState {
    pub config: Arc<ServerConfig>,
    pub session_context_config: Arc<ResolvedSessionContextConfig>,
    pub creds_manage_store: Arc<CredsManageStore>,
    pub backend_oidc_runtime:
        Arc<BackendOidcModeRuntime<MokaPendingAuthStateMetadataRedemptionStore>>,
    pub frontend_oidc_runtime: Option<Arc<FrontendOidcModeRuntime>>,
    pub substrate_runtime: AccessTokenSubstrateRuntime,
    pub basic_auth_context: Arc<BasicAuthContext<Argon2BasicAuthCred>>,
    pub real_ip_resolver: Option<Arc<RealIpResolver>>,
    /// None when OIDC is disabled (oidc_enabled = false) for local debugging.
    pub oidc_client: Option<Arc<OidcClient<MokaPendingOauthStore>>>,
    /// None when [oauth_resource_server] config is absent or has no discovery
    /// source.
    pub oauth_resource_server_verifier: Option<Arc<OAuthResourceServerVerifier>>,
    /// None when [oauth_resource_server.token_propagation] is not enabled.
    pub propagation_forwarder: Option<Arc<AxumReverseProxyPropagationForwarder>>,
}

impl ServerState {
    pub fn session_auth_service(&self) -> OidcSessionAuthService<'_, MokaPendingOauthStore> {
        OidcSessionAuthService::new_with_config(
            self.oidc_client.as_deref(),
            &self.session_context_config,
            OidcSessionAuthServiceConfig::new(SESSION_AUTH_CALLBACK_PATH),
        )
        .expect("session auth service config must be valid")
    }

    pub fn basic_auth_context_service(&self) -> BasicAuthContextService<'_, Argon2BasicAuthCred> {
        BasicAuthContextService::new(&self.basic_auth_context)
            .expect("basic-auth context service config must be valid")
    }

    pub fn resource_service(&self) -> Option<AccessTokenSubstrateResourceService<'_>> {
        let verifier = self.oauth_resource_server_verifier.as_deref()?;
        Some(AccessTokenSubstrateResourceService::new(
            &self.substrate_runtime,
            verifier,
        ))
    }

    pub fn backend_oidc_mode_auth_service(
        &self,
    ) -> ServerResult<
        BackendOidcModeAuthService<
            '_,
            MokaPendingOauthStore,
            MokaPendingAuthStateMetadataRedemptionStore,
        >,
    > {
        let oidc = self
            .oidc_client
            .as_deref()
            .ok_or(ServerError::InvalidConfig {
                message: "BackendOidcModeAuthService requires OIDC to be enabled".to_string(),
            })?;
        Ok(BackendOidcModeAuthService::new(
            oidc,
            &self.backend_oidc_runtime,
            TOKEN_SET_BACKEND_MODE_CALLBACK_PATH,
        ))
    }

    pub fn frontend_oidc_mode_service(&self) -> ServerResult<FrontendOidcModeService> {
        let runtime = self
            .frontend_oidc_runtime
            .as_deref()
            .ok_or(ServerError::InvalidConfig {
                message: "FrontendOidcModeService requires OIDC to be enabled".to_string(),
            })?;
        Ok(FrontendOidcModeService::new(runtime.clone()))
    }

    pub fn external_base_url(&self, headers: &HeaderMap) -> Result<Url, ServerError> {
        self.config
            .server
            .external_base_url
            .resolve_url(headers, &self.config.server.host, self.config.server.port)
            .map_err(|e| OidcError::RedirectUrl { source: e }.into())
    }

    pub async fn resolve_client_ip(
        &self,
        headers: &HeaderMap,
        peer_addr: Option<SocketAddr>,
    ) -> Option<ResolvedClientIp> {
        let resolver = self.real_ip_resolver.as_deref()?;
        let peer_ip = peer_addr?.ip();

        Some(
            resolver
                .resolve(peer_ip, headers, &TransportContext::default())
                .await,
        )
    }
}
