pub mod auth;
pub mod entries;
pub mod forward_auth;
pub mod groups;
pub mod health;

use axum::{
    Router, middleware,
    routing::{delete, get, post, put},
};

use crate::{middleware::require_session, state::ServerState};

/// Build the complete application router.
pub fn build_router(state: ServerState) -> Router {
    let session_auth_routes = Router::new()
        .route("/login", get(auth::login))
        .route("/callback", get(auth::callback))
        .route("/logout", post(auth::logout))
        .route("/me", get(auth::me));
    let token_set_auth_routes = Router::new()
        .route("/login", get(auth::login_token_set))
        .route("/callback", get(auth::callback_token_set))
        .route("/refresh", post(auth::refresh_token))
        .route("/metadata/redeem", post(auth::redeem_metadata));
    let basic_auth_routes = Router::new();
    let auth_routes = Router::new()
        .nest("/auth/session", session_auth_routes)
        .nest("/auth/token-set", token_set_auth_routes)
        .nest("/auth/basic", basic_auth_routes);

    let api_routes = Router::new()
        .route("/api/entries", get(entries::list))
        .route("/api/entries/basic", post(entries::create_basic))
        .route("/api/entries/token", post(entries::create_token))
        .route("/api/entries/{id}", get(entries::get))
        .route("/api/entries/{id}", put(entries::update))
        .route("/api/entries/{id}", delete(entries::delete))
        .route("/api/groups", get(groups::list))
        .route("/api/groups", post(groups::create))
        .route("/api/groups/{id}", get(groups::get))
        .route("/api/groups/{id}", put(groups::update))
        .route("/api/groups/{id}", delete(groups::delete))
        .layer(middleware::from_fn(require_session));

    let forward_auth_routes = Router::new()
        .route(
            "/api/forwardauth/traefik/{group}",
            get(forward_auth::traefik),
        )
        .route("/api/forwardauth/nginx/{group}", get(forward_auth::nginx));

    let app = Router::new()
        .route("/api/health", get(health::health))
        .merge(auth_routes)
        .merge(api_routes)
        .merge(forward_auth_routes);

    // Serve static webui files if configured
    let app = if let Some(ref webui_dir) = state.config.server.webui_dir {
        app.fallback_service(tower_http::services::ServeDir::new(webui_dir).fallback(
            tower_http::services::ServeFile::new(format!("{webui_dir}/index.html")),
        ))
    } else {
        app
    };

    app.layer(axum::Extension(state))
}
