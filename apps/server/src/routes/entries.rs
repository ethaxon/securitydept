use axum::extract::Path;
use axum::{Extension, Json};

use securitydept_core::auth;
use securitydept_core::models::{
    AuthEntry, CreateBasicEntryRequest, CreateTokenEntryRequest,
    CreateTokenEntryResponse, UpdateEntryRequest,
};

use crate::error::AppError;
use crate::state::AppState;

/// GET /api/entries
pub async fn list(Extension(state): Extension<AppState>) -> Json<Vec<AuthEntry>> {
    Json(state.store.list_entries().await)
}

/// GET /api/entries/:id
pub async fn get(
    Extension(state): Extension<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AuthEntry>, AppError> {
    let entry = state.store.get_entry(&id).await?;
    Ok(Json(entry))
}

/// POST /api/entries/basic
pub async fn create_basic(
    Extension(state): Extension<AppState>,
    Json(req): Json<CreateBasicEntryRequest>,
) -> Result<Json<AuthEntry>, AppError> {
    let password_hash = auth::hash_password(&req.password)?;
    let entry = AuthEntry::new_basic(req.name, req.username, password_hash, req.groups);
    let created = state.store.create_entry(entry).await?;
    Ok(Json(created))
}

/// POST /api/entries/token
pub async fn create_token(
    Extension(state): Extension<AppState>,
    Json(req): Json<CreateTokenEntryRequest>,
) -> Result<Json<CreateTokenEntryResponse>, AppError> {
    let (token, token_hash) = auth::generate_token()?;
    let entry = AuthEntry::new_token(req.name, token_hash, req.groups);
    let created = state.store.create_entry(entry).await?;
    Ok(Json(CreateTokenEntryResponse {
        entry: created,
        token,
    }))
}

/// PUT /api/entries/:id
pub async fn update(
    Extension(state): Extension<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateEntryRequest>,
) -> Result<Json<AuthEntry>, AppError> {
    // If a new password was provided, hash it
    let password_hash = match req.password {
        Some(ref pw) => Some(auth::hash_password(pw)?),
        None => None,
    };

    let updated = state
        .store
        .update_entry(&id, req.name, req.username, password_hash, req.groups)
        .await?;
    Ok(Json(updated))
}

/// DELETE /api/entries/:id
pub async fn delete(
    Extension(state): Extension<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.store.delete_entry(&id).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}
