pub mod auth;
pub mod entries;
pub mod forward_auth;
pub mod groups;

use axum::middleware;
use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::middleware::require_session;
use crate::state::AppState;

/// Build the complete application router.
pub fn build_router(state: AppState) -> Router {
    let auth_routes = Router::new()
        .route("/auth/login", get(auth::login))
        .route("/auth/callback", get(auth::callback))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me));

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
        .route(
            "/api/forwardauth/nginx/{group}",
            get(forward_auth::nginx),
        );

    let app = Router::new()
        .merge(auth_routes)
        .merge(api_routes)
        .merge(forward_auth_routes);

    // Serve static webui files if configured
    let app = if let Some(ref webui_dir) = state.config.server.webui_dir {
        app.fallback_service(
            tower_http::services::ServeDir::new(webui_dir)
                .fallback(tower_http::services::ServeFile::new(
                    format!("{webui_dir}/index.html"),
                )),
        )
    } else {
        app
    };

    app.layer(axum::Extension(state))
}
