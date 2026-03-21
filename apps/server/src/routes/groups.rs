use axum::{Extension, Json, extract::Path};
use securitydept_core::creds_manage::models::{CreateGroupRequest, Group, UpdateGroupRequest};

use crate::{error::ServerError, state::ServerState};

/// GET /api/groups
pub async fn list(Extension(state): Extension<ServerState>) -> Json<Vec<Group>> {
    Json(state.creds_manage_store.list_groups().await)
}

/// GET /api/groups/:id
pub async fn get(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<Group>, ServerError> {
    let group = state.creds_manage_store.get_group(&id).await?;
    Ok(Json(group))
}

/// POST /api/groups
pub async fn create(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateGroupRequest>,
) -> Result<Json<Group>, ServerError> {
    let group = Group::new(req.name);
    let created = state
        .creds_manage_store
        .create_group(group, req.entry_ids)
        .await?;
    Ok(Json(created))
}

/// PUT /api/groups/:id
pub async fn update(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateGroupRequest>,
) -> Result<Json<Group>, ServerError> {
    let updated = state
        .creds_manage_store
        .update_group(&id, req.name, req.entry_ids)
        .await?;
    Ok(Json(updated))
}

/// DELETE /api/groups/:id
pub async fn delete(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    state.creds_manage_store.delete_group(&id).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}
