pub mod auth;
pub mod entries;
pub mod forward_auth;
pub mod groups;
pub mod health;
pub mod propagation;

use axum::{
    Router, middleware,
    routing::{any, delete, get, post, put},
};

use crate::{
    middleware::{require_basic_auth, require_dashboard_auth},
    state::ServerState,
};

/// Build the complete application router.
pub fn build_router(state: ServerState) -> Router {
    let session_auth_routes = Router::new()
        .route("/login", get(auth::session::login))
        .route("/callback", get(auth::session::callback))
        .route("/logout", post(auth::session::logout))
        .route("/me", get(auth::session::me));
    let token_set_auth_routes = Router::new()
        .route("/login", get(auth::token_set::login))
        .route("/callback", get(auth::token_set::callback))
        .route("/refresh", post(auth::token_set::refresh))
        .route("/metadata/redeem", post(auth::token_set::redeem_metadata))
        .route("/user-info", post(auth::token_set::user_info));
    let auth_routes = Router::new()
        .nest("/auth/session", session_auth_routes)
        .nest("/auth/token-set", token_set_auth_routes);

    let creds_manage_api_routes = Router::new()
        .route("/entries", get(entries::list))
        .route("/entries/basic", post(entries::create_basic))
        .route("/entries/token", post(entries::create_token))
        .route("/entries/{id}", get(entries::get))
        .route("/entries/{id}", put(entries::update))
        .route("/entries/{id}", delete(entries::delete))
        .route("/groups", get(groups::list))
        .route("/groups", post(groups::create))
        .route("/groups/{id}", get(groups::get))
        .route("/groups/{id}", put(groups::update))
        .route("/groups/{id}", delete(groups::delete));

    let api_routes = Router::new()
        .nest("/api", creds_manage_api_routes.clone())
        .layer(middleware::from_fn(require_dashboard_auth));
    let basic_api_routes = Router::new()
        .nest("/basic/api", creds_manage_api_routes)
        .layer(middleware::from_fn(require_basic_auth));

    let forward_auth_routes = Router::new()
        .route(
            "/api/forwardauth/traefik/{group}",
            get(forward_auth::traefik),
        )
        .route("/api/forwardauth/nginx/{group}", get(forward_auth::nginx));

    // Propagation forwarding: forward bearer-authenticated requests with
    // propagation context to downstream services via reverse proxy.
    let propagation_routes = if state.propagation_forwarder.is_some() {
        Router::new()
            .route(
                "/api/propagation/{*rest}",
                any(propagation::propagation_forward),
            )
            .layer(middleware::from_fn(require_dashboard_auth))
    } else {
        Router::new()
    };

    let app = Router::new()
        .route("/api/health", get(health::health))
        .nest("/basic", auth::basic::router())
        .merge(auth_routes)
        .merge(api_routes)
        .merge(basic_api_routes)
        .merge(forward_auth_routes)
        .merge(propagation_routes);

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
