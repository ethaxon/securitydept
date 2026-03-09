use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use securitydept_core::{
    creds::CredsError, creds_manage::CredsManageError, oidc::OidcError,
    session_context::SessionContextError, utils::http::ToHttpStatus,
};
use serde_json::json;
use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum ServerError {
    #[snafu(display("Failed to load config: {message}"))]
    ConfigLoad { message: String },
    #[snafu(display("Invalid configuration: {message}"))]
    InvalidConfig { message: String },
    #[snafu(display("Server boot error: {source}"))]
    ServerBoot {
        source: Box<dyn std::error::Error + Send + Sync>,
    },
    #[snafu(transparent)]
    CredsManage { source: CredsManageError },
    #[snafu(transparent)]
    Oidc { source: OidcError },
    #[snafu(transparent)]
    Creds { source: CredsError },
    #[snafu(transparent)]
    SessionContext { source: SessionContextError },
}

impl ToHttpStatus for ServerError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            creds_error @ ServerError::Creds { .. } => creds_error.to_http_status(),
            creds_manage_error @ ServerError::CredsManage { .. } => {
                creds_manage_error.to_http_status()
            }
            oidc_error @ ServerError::Oidc { .. } => oidc_error.to_http_status(),
            ServerError::SessionContext { source } => source.status_code(),
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        let status = self.to_http_status();
        let message = self.to_string();

        let body = json!({ "error": message, "status": status.as_u16(), "success": false });
        (status, axum::Json(body)).into_response()
    }
}

pub type ServerResult<T> = std::result::Result<T, ServerError>;
