use axum::{Extension, Json, extract::Path};
use securitydept_core::{
    creds_manage::models::{
        AuthEntry, CreateBasicEntryRequest, CreateBasicEntryResponse, CreateTokenEntryRequest,
        CreateTokenEntryResponse, UpdateEntryRequest,
    },
    utils::observability::{
        AuthFlowDiagnosis, AuthFlowDiagnosisField, AuthFlowDiagnosisOutcome, AuthFlowOperation,
    },
};

use crate::{
    diagnosis::{RouteDiagnosisContext, log_route_diagnosis, log_route_diagnosis_error},
    error::ServerError,
    state::ServerState,
};

const ENTRY_ENTITY_KIND: &str = "entry";

fn entry_route_base_diagnosis(
    operation: &'static str,
    route: &'static str,
    method: &'static str,
    operation_kind: &'static str,
) -> AuthFlowDiagnosis {
    AuthFlowDiagnosis::started(operation)
        .field(AuthFlowDiagnosisField::ROUTE, route)
        .field(AuthFlowDiagnosisField::METHOD, method)
        .field(AuthFlowDiagnosisField::ENTITY_KIND, ENTRY_ENTITY_KIND)
        .field(AuthFlowDiagnosisField::OPERATION_KIND, operation_kind)
}

fn entry_create_token_success_diagnosis(
    entry: &AuthEntry,
    group_ids_count: usize,
) -> AuthFlowDiagnosis {
    entry_route_base_diagnosis(
        AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_TOKEN,
        "/api/entries/token",
        "POST",
        "create_token",
    )
    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
    .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
    .field(AuthFlowDiagnosisField::TARGET_ID, entry.meta.id.clone())
    .field(AuthFlowDiagnosisField::GROUP_IDS_COUNT, group_ids_count)
    .field(AuthFlowDiagnosisField::TOKEN_CREATED, true)
}

fn entry_route_failure_diagnosis(
    operation: &'static str,
    route: &'static str,
    method: &'static str,
    operation_kind: &'static str,
    target_id: Option<&str>,
) -> AuthFlowDiagnosis {
    let diagnosis = entry_route_base_diagnosis(operation, route, method, operation_kind)
        .with_outcome(AuthFlowDiagnosisOutcome::Failed)
        .field(AuthFlowDiagnosisField::HAS_TARGET_ID, target_id.is_some());

    if let Some(target_id) = target_id {
        diagnosis.field(AuthFlowDiagnosisField::TARGET_ID, target_id)
    } else {
        diagnosis
    }
}

/// GET /api/entries
pub async fn list(Extension(state): Extension<ServerState>) -> Json<Vec<AuthEntry>> {
    let entries = state.creds_manage_store.list_entries().await;
    let diagnosis = entry_route_base_diagnosis(
        AuthFlowOperation::CREDS_MANAGE_ENTRY_LIST,
        "/api/entries",
        "GET",
        "list",
    )
    .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
    .field(AuthFlowDiagnosisField::HAS_TARGET_ID, false)
    .field(AuthFlowDiagnosisField::RESULT_COUNT, entries.len());
    log_route_diagnosis(
        RouteDiagnosisContext {
            route: "/api/entries",
            method: "GET",
            status: Some(200),
        },
        &diagnosis,
        "Entries list completed",
    );

    Json(entries)
}

/// GET /api/entries/:id
pub async fn get(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<AuthEntry>, ServerError> {
    match state.creds_manage_store.get_entry(&id).await {
        Ok(entry) => {
            let diagnosis = entry_route_base_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_GET,
                "/api/entries/:id",
                "GET",
                "get",
            )
            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
            .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
            .field(AuthFlowDiagnosisField::TARGET_ID, id.clone());
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/entries/:id",
                    method: "GET",
                    status: Some(200),
                },
                &diagnosis,
                "Entry get completed",
            );
            Ok(Json(entry))
        }
        Err(error) => {
            let diagnosis = entry_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_GET,
                "/api/entries/:id",
                "GET",
                "get",
                Some(&id),
            );
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/entries/:id",
                    method: "GET",
                    status: None,
                },
                &diagnosis,
                &error,
                "Entry get failed",
            );
            Err(error.into())
        }
    }
}

/// POST /api/entries/basic
pub async fn create_basic(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateBasicEntryRequest>,
) -> Result<Json<CreateBasicEntryResponse>, ServerError> {
    let group_ids_count = req.group_ids.len();
    match state
        .creds_manage_store
        .create_basic_entry(req.name, req.username, req.password, req.group_ids)
        .await
    {
        Ok(created) => {
            let diagnosis = entry_route_base_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_BASIC,
                "/api/entries/basic",
                "POST",
                "create_basic",
            )
            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
            .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
            .field(AuthFlowDiagnosisField::TARGET_ID, created.meta.id.clone())
            .field(AuthFlowDiagnosisField::GROUP_IDS_COUNT, group_ids_count);
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/entries/basic",
                    method: "POST",
                    status: Some(200),
                },
                &diagnosis,
                "Basic entry create completed",
            );
            Ok(Json(CreateBasicEntryResponse { entry: created }))
        }
        Err(error) => {
            let diagnosis = entry_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_BASIC,
                "/api/entries/basic",
                "POST",
                "create_basic",
                None,
            )
            .field(AuthFlowDiagnosisField::GROUP_IDS_COUNT, group_ids_count);
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/entries/basic",
                    method: "POST",
                    status: None,
                },
                &diagnosis,
                &error,
                "Basic entry create failed",
            );
            Err(error.into())
        }
    }
}

/// POST /api/entries/token
pub async fn create_token(
    Extension(state): Extension<ServerState>,
    Json(req): Json<CreateTokenEntryRequest>,
) -> Result<Json<CreateTokenEntryResponse>, ServerError> {
    let group_ids_count = req.group_ids.len();
    match state
        .creds_manage_store
        .create_token_entry(req.name, req.group_ids)
        .await
    {
        Ok((created, token)) => {
            let diagnosis = entry_create_token_success_diagnosis(&created, group_ids_count);
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/entries/token",
                    method: "POST",
                    status: Some(200),
                },
                &diagnosis,
                "Token entry create completed",
            );
            Ok(Json(CreateTokenEntryResponse {
                entry: created,
                token,
            }))
        }
        Err(error) => {
            let diagnosis = entry_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_TOKEN,
                "/api/entries/token",
                "POST",
                "create_token",
                None,
            )
            .field(AuthFlowDiagnosisField::GROUP_IDS_COUNT, group_ids_count)
            .field(AuthFlowDiagnosisField::TOKEN_CREATED, false);
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/entries/token",
                    method: "POST",
                    status: None,
                },
                &diagnosis,
                &error,
                "Token entry create failed",
            );
            Err(error.into())
        }
    }
}

/// PUT /api/entries/:id
pub async fn update(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateEntryRequest>,
) -> Result<Json<AuthEntry>, ServerError> {
    let group_ids_count = req.group_ids.as_ref().map_or(0, Vec::len);
    match state
        .creds_manage_store
        .update_entry(&id, req.name, req.username, req.password, req.group_ids)
        .await
    {
        Ok(updated) => {
            let diagnosis = entry_route_base_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_UPDATE,
                "/api/entries/:id",
                "PUT",
                "update",
            )
            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
            .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
            .field(AuthFlowDiagnosisField::TARGET_ID, id.clone())
            .field(AuthFlowDiagnosisField::GROUP_IDS_COUNT, group_ids_count);
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/entries/:id",
                    method: "PUT",
                    status: Some(200),
                },
                &diagnosis,
                "Entry update completed",
            );
            Ok(Json(updated))
        }
        Err(error) => {
            let diagnosis = entry_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_UPDATE,
                "/api/entries/:id",
                "PUT",
                "update",
                Some(&id),
            )
            .field(AuthFlowDiagnosisField::GROUP_IDS_COUNT, group_ids_count);
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/entries/:id",
                    method: "PUT",
                    status: None,
                },
                &diagnosis,
                &error,
                "Entry update failed",
            );
            Err(error.into())
        }
    }
}

/// DELETE /api/entries/:id
pub async fn delete(
    Extension(state): Extension<ServerState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ServerError> {
    match state.creds_manage_store.delete_entry(&id).await {
        Ok(()) => {
            let diagnosis = entry_route_base_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_DELETE,
                "/api/entries/:id",
                "DELETE",
                "delete",
            )
            .with_outcome(AuthFlowDiagnosisOutcome::Succeeded)
            .field(AuthFlowDiagnosisField::HAS_TARGET_ID, true)
            .field(AuthFlowDiagnosisField::TARGET_ID, id.clone());
            log_route_diagnosis(
                RouteDiagnosisContext {
                    route: "/api/entries/:id",
                    method: "DELETE",
                    status: Some(200),
                },
                &diagnosis,
                "Entry delete completed",
            );
            Ok(Json(serde_json::json!({"ok": true})))
        }
        Err(error) => {
            let diagnosis = entry_route_failure_diagnosis(
                AuthFlowOperation::CREDS_MANAGE_ENTRY_DELETE,
                "/api/entries/:id",
                "DELETE",
                "delete",
                Some(&id),
            );
            log_route_diagnosis_error(
                RouteDiagnosisContext {
                    route: "/api/entries/:id",
                    method: "DELETE",
                    status: None,
                },
                &diagnosis,
                &error,
                "Entry delete failed",
            );
            Err(error.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{Extension, Json, http::StatusCode, response::IntoResponse};
    use securitydept_core::creds_manage::models::{AuthEntryKind, AuthEntryMeta};

    use super::*;
    use crate::routes::test_support::{assert_server_error_envelope, test_server_state};

    fn sample_entry() -> AuthEntry {
        AuthEntry {
            meta: AuthEntryMeta::new("api-token".to_string(), vec!["group-1".to_string()]),
            kind: AuthEntryKind::Token,
            username: None,
        }
    }

    #[test]
    fn entry_create_token_success_diagnosis_does_not_leak_token_value() {
        let entry = sample_entry();
        let diagnosis = entry_create_token_success_diagnosis(&entry, 1);
        let serialized = diagnosis.to_json_value().to_string();

        assert_eq!(
            diagnosis.operation,
            AuthFlowOperation::CREDS_MANAGE_ENTRY_CREATE_TOKEN
        );
        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Succeeded);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::TOKEN_CREATED],
            true
        );
        assert!(!serialized.contains("token-value"));
        assert!(!serialized.contains("Authorization"));
    }

    #[test]
    fn entry_route_failure_diagnosis_reports_failed_outcome() {
        let diagnosis = entry_route_failure_diagnosis(
            AuthFlowOperation::CREDS_MANAGE_ENTRY_UPDATE,
            "/api/entries/:id",
            "PUT",
            "update",
            Some("entry-1"),
        );

        assert_eq!(diagnosis.outcome, AuthFlowDiagnosisOutcome::Failed);
        assert_eq!(
            diagnosis.fields[AuthFlowDiagnosisField::TARGET_ID],
            "entry-1"
        );
    }

    #[tokio::test]
    async fn create_basic_with_invalid_material_returns_shared_server_error_envelope() {
        let state = test_server_state("invalid-basic-material").await;

        let response = create_basic(
            Extension(state),
            Json(CreateBasicEntryRequest {
                name: "ops-user".to_string(),
                username: "   ".to_string(),
                password: "secret123".to_string(),
                group_ids: Vec::new(),
            }),
        )
        .await
        .expect_err("invalid basic entry material should fail")
        .into_response();

        assert_server_error_envelope(
            response,
            StatusCode::UNAUTHORIZED,
            "unauthenticated",
            "auth_invalid_credentials_format",
            "reauthenticate",
        )
        .await;
    }
}
