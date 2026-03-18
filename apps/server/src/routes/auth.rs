use std::collections::HashMap;

use axum::{
    Extension, Json,
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use securitydept_core::{
    creds_manage::models::UserInfo,
    oidc::{OidcCodeCallbackSearchParams, OidcError},
    session_context::{SessionContext, SessionPrincipal},
    token_set_context::{
        AuthStateCoordinator, MetadataRedemptionRequest, MetadataRedemptionResponse,
        OidcAuthStateOptions, TokenRefreshPayload, TokenSetAuthorizeQuery,
    },
};
use serde_json::Value;
use tower_sessions::Session;
use tracing::info;

use crate::{
    error::{ServerError, ServerResult},
    state::ServerState,
};

/// GET /auth/login -- redirect to OIDC provider, or create dev session when
/// OIDC is disabled.
pub async fn login(
    Extension(state): Extension<ServerState>,
    session: Session,
    headers: HeaderMap,
) -> Result<Response, ServerError> {
    if let Some(ref oidc) = state.oidc {
        let external_base_url = state
            .config
            .server
            .external_base_url
            .resolve_url(
                &headers,
                &state.config.server.host,
                state.config.server.port,
            )
            .map_err(|e| OidcError::RedirectUrl { source: e })?;
        let authorization_request = oidc
            .handle_code_authorize(&external_base_url, &state.pending_oauth)
            .await?;
        let authorization_url = authorization_request.authorization_url;
        return Ok(Redirect::temporary(authorization_url.as_str()).into_response());
    }

    // OIDC disabled: create a dev session for local debugging
    let handle = state.session_config.session_handle(session);
    handle.cycle_id().await?;

    let context: SessionContext = SessionContext::builder()
        .principal(
            SessionPrincipal::builder()
                .display_name("dev")
                .claims(HashMap::from([(
                    "oidc_enabled".to_string(),
                    Value::Bool(false),
                )]))
                .build(),
        )
        .build();
    handle.insert(&context).await?;

    Ok(Redirect::to("/").into_response())
}

/// GET /auth/login/token-set -- redirect to OIDC provider for stateless
/// token-set mode.
pub async fn login_token_set(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(query): Query<TokenSetAuthorizeQuery>,
) -> Result<Response, ServerError> {
    let oidc = state.oidc_client()?;
    let external_base_url = state
        .config
        .server
        .external_base_url
        .resolve_url(
            &headers,
            &state.config.server.host,
            state.config.server.port,
        )
        .map_err(|e| OidcError::RedirectUrl { source: e })?;
    let coordinator = AuthStateCoordinator::new(&state.token_set_context, oidc);
    let authorization_request = coordinator
        .authorize_code_flow(
            &external_base_url,
            &state.pending_oauth,
            query.redirect_uri.as_deref(),
            Some("/auth/callback/token-set"),
        )
        .await
        .map_err(|e| ServerError::InvalidConfig {
            message: e.to_string(),
        })?;

    Ok(Redirect::temporary(authorization_request.authorization_url.as_str()).into_response())
}

/// GET /auth/callback
/// Handle OIDC code exchange.
pub async fn callback(
    Extension(state): Extension<ServerState>,
    session: Session,
    headers: HeaderMap,
    Query(search_params): Query<OidcCodeCallbackSearchParams>,
) -> Result<Response, ServerError> {
    let oidc = state.oidc_client()?;

    let external_base_url = state
        .config
        .server
        .external_base_url
        .resolve_url(
            &headers,
            &state.config.server.host,
            state.config.server.port,
        )
        .map_err(|e| OidcError::RedirectUrl { source: e })?;

    let code_callback_result = oidc
        .handle_code_callback(search_params, &external_base_url, &state.pending_oauth)
        .await?;
    let claims_check_result = code_callback_result.claims_check_result;

    let handle = state.session_config.session_handle(session);
    handle.cycle_id().await?;

    let principal = SessionPrincipal {
        display_name: claims_check_result.display_name.clone(),
        picture: claims_check_result.picture,
        claims: claims_check_result.claims,
    };

    let context: SessionContext = SessionContext::builder().principal(principal).build();
    handle.insert(&context).await?;

    info!(display_name = %claims_check_result.display_name, "User logged in");

    Ok(Redirect::to("/").into_response())
}

/// GET /auth/callback/token-set
/// Handle OIDC code exchange for stateless token-set mode.
pub async fn callback_token_set(
    Extension(state): Extension<ServerState>,
    headers: HeaderMap,
    Query(search_params): Query<OidcCodeCallbackSearchParams>,
) -> Result<Response, ServerError> {
    let oidc = state.oidc_client()?;
    let external_base_url = state
        .config
        .server
        .external_base_url
        .resolve_url(
            &headers,
            &state.config.server.host,
            state.config.server.port,
        )
        .map_err(|e| OidcError::RedirectUrl { source: e })?;
    let coordinator = AuthStateCoordinator::new(&state.token_set_context, oidc);
    let coordination_result = coordinator
        .handle_code_callback_with_metadata_store(
            search_params,
            &external_base_url,
            &state.pending_oauth,
            &OidcAuthStateOptions::default(),
            state.metadata_redemption_store.as_ref(),
            Some("/auth/callback/token-set"),
        )
        .await
        .map_err(|e| ServerError::InvalidConfig {
            message: e.to_string(),
        })?;
    let mut redirect_uri = coordination_result.redirect_uri;
    let fragment = coordination_result.redirect_fragment.to_fragment();

    redirect_uri.set_fragment(Some(&fragment));
    Ok(Redirect::to(redirect_uri.as_str()).into_response())
}

/// POST /auth/logout -- destroy session.
pub async fn logout(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Response> {
    let handle = state.session_config.session_handle(session);
    handle.flush().await?;

    Ok(Json(serde_json::json!({"ok": true})).into_response())
}

pub async fn refresh_token(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<TokenRefreshPayload>,
) -> ServerResult<Response> {
    let oidc_client = state.oidc_client()?;
    let coordinator = AuthStateCoordinator::new(&state.token_set_context, oidc_client);
    let coordination_result = coordinator
        .refresh_from_payload_with_metadata_store(
            &payload,
            Some(state.metadata_redemption_store.as_ref()),
        )
        .await
        .map_err(|e| ServerError::InvalidConfig {
            message: e.to_string(),
        })?;
    let mut redirect_uri = coordination_result.redirect_uri;
    let fragment = coordination_result.redirect_fragment.to_fragment();

    redirect_uri.set_fragment(Some(&fragment));
    Ok(Redirect::to(redirect_uri.as_str()).into_response())
}

pub async fn redeem_metadata(
    Extension(state): Extension<ServerState>,
    Json(payload): Json<MetadataRedemptionRequest>,
) -> ServerResult<Response> {
    let metadata = state
        .metadata_redemption_store
        .redeem(&payload.metadata_redemption_id, chrono::Utc::now())
        .map_err(|e| ServerError::InvalidConfig {
            message: e.to_string(),
        })?;

    match metadata {
        Some(metadata) => Ok(Json(MetadataRedemptionResponse { metadata }).into_response()),
        None => Ok(StatusCode::NOT_FOUND.into_response()),
    }
}

/// GET /auth/me -- return current user info.
pub async fn me(
    Extension(state): Extension<ServerState>,
    session: Session,
) -> ServerResult<Json<UserInfo>> {
    let handle = state.session_config.session_handle(session);
    let context = handle.require::<HashMap<String, Value>>().await?;

    Ok(Json(UserInfo {
        display_name: context.principal.display_name,
        picture: context.principal.picture,
        claims: context.principal.claims,
    }))
}
