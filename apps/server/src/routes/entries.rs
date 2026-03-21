use axum::{Extension, Json, extract::Path};
use securitydept_core::creds_manage::models::{
    AuthEntry, CreateBasicEntryRequest, CreateBasicEntryResponse, CreateTokenEntryRequest,
    CreateTokenEntryResponse, UpdateEntryRequest,
};

use crate::{error::ServerError, state::ServerState};

/// GET /api/entries
pub async fn list(Extension(state): Extension<ServerState>) -> Json<Vec<AuthEntry>> {
    Json(state.creds_manage_store.list_entries().await)
}

/// GET /api/entries/:id
pub async fn get(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<AuthEntry>, ServerError> {
    let entry = state.creds_manage_store.get_entry(&id).await?;
    Ok(Json(entry))
}

/// POST /api/entries/basic
pub async fn create_basic(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateBasicEntryRequest>,
) -> Result<Json<CreateBasicEntryResponse>, ServerError> {
    let created = state
        .creds_manage_store
        .create_basic_entry(req.name, req.username, req.password, req.group_ids)
        .await?;
    Ok(Json(CreateBasicEntryResponse { entry: created }))
}

/// POST /api/entries/token
pub async fn create_token(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateTokenEntryRequest>,
) -> Result<Json<CreateTokenEntryResponse>, ServerError> {
    let (created, token) = state
        .creds_manage_store
        .create_token_entry(req.name, req.group_ids)
        .await?;
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
) -> Result<Json<AuthEntry>, ServerError> {
    let updated = state
        .creds_manage_store
        .update_entry(&id, req.name, req.username, req.password, req.group_ids)
        .await?;
    Ok(Json(updated))
}

/// DELETE /api/entries/:id
pub async fn delete(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.creds_manage_store.delete_entry(&id).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}
