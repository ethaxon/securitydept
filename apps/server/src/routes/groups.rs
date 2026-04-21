use axum::{Extension, Json, extract::Path};
use securitydept_core::{
    creds_manage::models::{CreateGroupRequest, Group, UpdateGroupRequest},
    utils::observability::{
        AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowDiagnosisOutcome, AuthFlowOperation,
    },
};

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::ServerError,
    state::ServerState,
};

const GROUP_ENTITY_KIND: &str = "group";

fn group_route_base_diagnosis(
    operation: &'static str,
    route: &'static str,
    method: &'static str,
    operation_kind: &'static str,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(operation)
        .field(AuthFlowDiagnosisField::ROUTE, route)
        .field(AuthFlowDiagnosisField::METHOD, method)
        .field(AuthFlowDiagnosisField::ENTITY_KIND, GROUP_ENTITY_KIND)
        .field(AuthFlowDiagnosisField::OPERATION_KIND, operation_kind)
}

fn group_create_success_diagnosis(group: &Group, entry_ids_count: usize) -> AuthFlowDiagnosis {
    group_route_base_diagnosis(
        AuthFlowOperation::CREDS_MANAGE_GROUP_CREATE,
        "/api/groups",
        "POST",
        "create",
    )
    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
    .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
    .field(AuthFlowDiagnosisField::TARGET_ID, group.id.clone())
    .field("entry_ids_count", entry_ids_count)
}

fn group_route_failure_diagnosis(
    operation: &'static str,
    route: &'static str,
    method: &'static str,
    operation_kind: &'static str,
    target_id: Option<&str>,
) -> AuthFlowDiagnosis {
    let diagnosis = group_route_base_diagnosis(operation, route, method, operation_kind)
        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
        .field(AuthFlowDiagnosisField::HAS_TARGET_ID, target_id.is_some());

    if let Some(target_id) = target_id {
        diagnosis.field(AuthFlowDiagnosisField::TARGET_ID, target_id)
    } else {
        diagnosis
    }
}

/// GET /api/groups
pub async fn list(Extension(state): Extension<ServerState>) -> Json<Vec<Group>> {
    let groups = state.creds_manage_store.list_groups().await;
    let diagnosis = group_route_base_diagnosis(
        AuthFlowOperation::CREDS_MANAGE_GROUP_LIST,
        "/api/groups",
        "GET",
        "list",
    )
    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
    .field(AuthFlowDiagnosisField::HAS_TARGET_ID, false)
    .field("result_count", groups.len());
    log_route_diagnosis(
        RouteDiagnosisContext {
            route: "/api/groups",
            method: "GET",
            status: Some(200),
        },
        &diagnosis,
        "Groups list completed",
    );

    Json(groups)
}

/// GET /api/groups/:id
pub async fn get(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<Group>, ServerError> {
    match state.creds_manage_store.get_group(&id).await {
        Ok(group) => {
            let diagnosis = group_route_base_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_GROUP_GET,
                "/api/groups/:id",
                "GET",
                "get",
            )
            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
            .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
            .field(AuthFlowDiagnosisField::TARGET_ID, id.clone());
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/groups/:id",
                    method: "GET",
                    status: Some(200),
                },
                &diagnosis,
                "Group get completed",
            );
            Ok(Json(group))
        }
        Err(error) => {
            let diagnosis = group_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_GROUP_GET,
                "/api/groups/:id",
                "GET",
                "get",
                Some(&id),
            );
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/groups/:id",
                    method: "GET",
                    status: None,
                },
                &diagnosis,
                &error,
                "Group get failed",
            );
            Err(error.into())
        }
    }
}

/// POST /api/groups
pub async fn create(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateGroupRequest>,
) -> Result<Json<Group>, ServerError> {
    let entry_ids_count = req.entry_ids.as_ref().map_or(0, Vec::len);
    let group = Group::new(req.name);
    let attempted_group_id = group.id.clone();
    match state
        .creds_manage_store
        .create_group(group, req.entry_ids)
        .await
    {
        Ok(created) => {
            let diagnosis = group_create_success_diagnosis(&created, entry_ids_count);
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/groups",
                    method: "POST",
                    status: Some(200),
                },
                &diagnosis,
                "Group create completed",
            );
            Ok(Json(created))
        }
        Err(error) => {
            let diagnosis = group_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_GROUP_CREATE,
                "/api/groups",
                "POST",
                "create",
                Some(&attempted_group_id),
            )
            .field("entry_ids_count", entry_ids_count);
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/groups",
                    method: "POST",
                    status: None,
                },
                &diagnosis,
                &error,
                "Group create failed",
            );
            Err(error.into())
        }
    }
}

/// PUT /api/groups/:id
pub async fn update(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateGroupRequest>,
) -> Result<Json<Group>, ServerError> {
    let entry_ids_count = req.entry_ids.as_ref().map_or(0, Vec::len);
    match state
        .creds_manage_store
        .update_group(&id, req.name, req.entry_ids)
        .await
    {
        Ok(updated) => {
            let diagnosis = group_route_base_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_GROUP_UPDATE,
                "/api/groups/:id",
                "PUT",
                "update",
            )
            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
            .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
            .field(AuthFlowDiagnosisField::TARGET_ID, id.clone())
            .field("entry_ids_count", entry_ids_count);
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/groups/:id",
                    method: "PUT",
                    status: Some(200),
                },
                &diagnosis,
                "Group update completed",
            );
            Ok(Json(updated))
        }
        Err(error) => {
            let diagnosis = group_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_GROUP_UPDATE,
                "/api/groups/:id",
                "PUT",
                "update",
                Some(&id),
            )
            .field("entry_ids_count", entry_ids_count);
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/groups/:id",
                    method: "PUT",
                    status: None,
                },
                &diagnosis,
                &error,
                "Group update failed",
            );
            Err(error.into())
        }
    }
}

/// DELETE /api/groups/:id
pub async fn delete(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    match state.creds_manage_store.delete_group(&id).await {
        Ok(()) => {
            let diagnosis = group_route_base_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_GROUP_DELETE,
                "/api/groups/:id",
                "DELETE",
                "delete",
            )
            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
            .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
            .field(AuthFlowDiagnosisField::TARGET_ID, id.clone());
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/groups/:id",
                    method: "DELETE",
                    status: Some(200),
                },
                &diagnosis,
                "Group delete completed",
            );
            Ok(Json(serde_json::json!({"ok": true})))
        }
        Err(error) => {
            let diagnosis = group_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_GROUP_DELETE,
                "/api/groups/:id",
                "DELETE",
                "delete",
                Some(&id),
            );
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/groups/:id",
                    method: "DELETE",
                    status: None,
                },
                &diagnosis,
                &error,
                "Group delete failed",
            );
            Err(error.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_create_success_diagnosis_reports_created_group_without_secret_fields() {
        let group = Group::new("Operators".to_string());
        let diagnosis = group_create_success_diagnosis(&group, 2);

        assert_eq!(
            diagnosis.operation,
            AuthFlowOperation::CREDS_MANAGE_GROUP_CREATE
        );
        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Succeeded);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::TARGET_ID],
            group.id
        );
        assert_eq!(diagnosis.fields["entry_ids_count"], 2);
    }

    #[test]
    fn group_route_failure_diagnosis_reports_failed_outcome() {
        let diagnosis = group_route_failure_diagnosis(
            AuthFlowOperation::CREDS_MANAGE_GROUP_UPDATE,
            "/api/groups/:id",
            "PUT",
            "update",
            Some("group-1"),
        );

        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Failed);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::TARGET_ID],
            "group-1"
        );
    }
}
