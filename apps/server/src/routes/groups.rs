use axum::extract::Path;
use axum::{Extension, Json};

use securitydept_core::models::{CreateGroupRequest, Group, UpdateGroupRequest};

use crate::error::AppError;
use crate::state::AppState;

/// GET /api/groups
pub async fn list(Extension(state): Extension<AppState>) -> Json<Vec<Group>> {
    Json(state.store.list_groups().await)
}

/// GET /api/groups/:id
pub async fn get(
    Extension(state): Extension<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Group>, AppError> {
    let group = state.store.get_group(&id).await?;
    Ok(Json(group))
}

/// POST /api/groups
pub async fn create(
    Extension(state): Extension<AppState>,
    Json(req): Json<CreateGroupRequest>,
) -> Result<Json<Group>, AppError> {
    let group = Group::new(req.name);
    let created = state.store.create_group(group, req.entry_ids).await?;
    Ok(Json(created))
}

/// PUT /api/groups/:id
pub async fn update(
    Extension(state): Extension<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateGroupRequest>,
) -> Result<Json<Group>, AppError> {
    let updated = state.store.update_group(&id, req.name, req.entry_ids).await?;
    Ok(Json(updated))
}

/// DELETE /api/groups/:id
pub async fn delete(
    Extension(state): Extension<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state.store.delete_group(&id).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}
