use axum::extract::Path;
use axum::{Extension, Json};

use securitydept_creds_manage::auth;
use securitydept_creds_manage::models::{
    AuthEntryMeta, CreateBasicEntryRequest, CreateTokenEntryRequest, CreateTokenEntryResponse,
    UpdateEntryRequest,
};

use crate::error::ServerError;
use crate::state::ServerState;

/// GET /api/entries
pub async fn list(Extension(state): Extension<ServerState>) -> Json<Vec<AuthEntryMeta>> {
    Json(state.store.list_entries().await)
}

/// GET /api/entries/:id
pub async fn get(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<AuthEntryMeta>, ServerError> {
    let entry = state.store.get_entry(&id).await?;
    Ok(Json(entry))
}

/// POST /api/entries/basic
pub async fn create_basic(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateBasicEntryRequest>,
) -> Result<Json<AuthEntryMeta>, ServerError> {
    let password_hash = auth::hash_password_argon2(&req.password)?;
    let entry = AuthEntryMeta::new_basic(req.name, req.username, password_hash, req.group_ids);
    let created = state.store.create_entry(entry).await?;
    Ok(Json(created))
}

/// POST /api/entries/token
pub async fn create_token(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateTokenEntryRequest>,
) -> Result<Json<CreateTokenEntryResponse>, ServerError> {
    let (token, token_hash) = auth::generate_token()?;
    let entry = AuthEntryMeta::new_token(req.name, token_hash, req.group_ids);
    let created = state.store.create_entry(entry).await?;
    Ok(Json(CreateTokenEntryResponse {
        entry: created,
        token,
    }))
}

/// PUT /api/entries/:id
pub async fn update(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateEntryRequest>,
) -> Result<Json<AuthEntryMeta>, ServerError> {
    // If a new password was provided, hash it
    let password_hash = match req.password {
        Some(ref pw) => Some(auth::hash_password_argon2(pw)?),
        None => None,
    };

    let updated = state
        .store
        .update_entry(&id, req.name, req.username, password_hash, req.group_ids)
        .await?;
    Ok(Json(updated))
}

/// DELETE /api/entries/:id
pub async fn delete(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.store.delete_entry(&id).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}
