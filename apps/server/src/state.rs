use std::{net::SocketAddr, sync::Arc};

use axum::http::HeaderMap;
pub use securitydept_core::oidc::MokaPendingOauthStore;
use securitydept_core::{
    basic_auth_context::{BasicAuthContext, BasicAuthContextService},
    creds::Argon2BasicAuthCred,
    creds_manage::store::CredsManageStore,
    oauth_resource_server::OAuthResourceServerVerifier,
    oidc::{OidcClient, OidcError},
    realip::{RealIpResolver, ResolvedClientIp, TransportContext},
    session_context::OidcSessionAuthService,
    token_set_context::{
        access_token_substrate::{
            AccessTokenSubstrateResourceService, AxumReverseProxyPropagationForwarder,
            TokenPropagator,
        },
        backend_oidc_mediated_mode::{
            BackendOidcMediatedModeAuthService, BackendOidcMediatedModeRuntime,
            MokaPendingAuthStateMetadataRedemptionStore,
        },
    },
};
use url::Url;

use crate::{
    config::ServerConfig,
    error::{ServerError, ServerResult},
};

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct ServerState {
    pub config: Arc<ServerConfig>,
    pub creds_manage_store: Arc<CredsManageStore>,
    pub mediated_runtime:
        Arc<BackendOidcMediatedModeRuntime<MokaPendingAuthStateMetadataRedemptionStore>>,
    pub token_propagator: Arc<TokenPropagator>,
    pub basic_auth_context: Arc<BasicAuthContext<Argon2BasicAuthCred>>,
    pub token_set_resource_verifier: Option<Arc<OAuthResourceServerVerifier>>,
    pub real_ip_resolver: Option<Arc<RealIpResolver>>,
    /// None when OIDC is disabled (oidc_enabled = false) for local debugging.
    pub oidc: Option<Arc<OidcClient<MokaPendingOauthStore>>>,
    /// None when [propagation_forwarder] config is absent.
    pub propagation_forwarder: Option<Arc<AxumReverseProxyPropagationForwarder>>,
}

impl ServerState {
    pub fn session_auth_service(&self) -> OidcSessionAuthService<'_, MokaPendingOauthStore> {
        OidcSessionAuthService::new(self.oidc.as_deref(), &self.config.session_context)
            .expect("session auth service config must be valid")
    }

    pub fn basic_auth_context_service(&self) -> BasicAuthContextService<'_, Argon2BasicAuthCred> {
        BasicAuthContextService::new(&self.basic_auth_context)
            .expect("basic-auth context service config must be valid")
    }

    pub fn resource_service(&self) -> Option<AccessTokenSubstrateResourceService<'_>> {
        self.token_set_resource_verifier
            .as_deref()
            .map(AccessTokenSubstrateResourceService::new)
    }

    pub fn mediated_auth_service(
        &self,
    ) -> ServerResult<
        BackendOidcMediatedModeAuthService<
            '_,
            MokaPendingOauthStore,
            MokaPendingAuthStateMetadataRedemptionStore,
        >,
    > {
        let oidc = self.oidc.as_deref().ok_or(ServerError::InvalidConfig {
            message: "BackendOidcMediatedModeAuthService requires OIDC to be enabled".to_string(),
        })?;
        Ok(BackendOidcMediatedModeAuthService::new(
            oidc,
            &self.mediated_runtime,
            "/auth/token-set/callback",
        ))
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
