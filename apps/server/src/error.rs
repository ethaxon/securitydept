use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use securitydept_core::{
    basic_auth_context::BasicAuthContextServiceError,
    creds::CredsError,
    creds_manage::CredsManageError,
    oidc::OidcError,
    session_context::{SessionAuthServiceError, SessionContextError},
    token_set_context::{
        access_token_substrate::{AccessTokenSubstrateResourceServiceError, TokenPropagatorError},
        backend_oidc_mode::BackendOidcModeRuntimeError,
    },
    utils::{
        error::{ErrorPresentation, ToErrorPresentation, UserRecovery},
        http::ToHttpStatus,
    },
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
    #[snafu(transparent)]
    SessionAuthService { source: SessionAuthServiceError },
    #[snafu(transparent)]
    BasicAuthContextService {
        source: BasicAuthContextServiceError,
    },
    #[snafu(transparent)]
    BackendOidcRuntime { source: BackendOidcModeRuntimeError },
    #[snafu(transparent)]
    ResourceService {
        source: AccessTokenSubstrateResourceServiceError,
    },
    #[snafu(transparent)]
    TokenPropagator { source: TokenPropagatorError },
}

impl ToHttpStatus for ServerError {
    fn to_http_status(&self) -> StatusCode {
        match self {
            ServerError::Creds { .. } => self.to_http_status(),
            ServerError::CredsManage { .. } => self.to_http_status(),
            ServerError::Oidc { .. } => self.to_http_status(),
            ServerError::SessionAuthService { source } => source.status_code(),
            ServerError::SessionContext { source } => source.status_code(),
            ServerError::BasicAuthContextService { source } => source.to_http_status(),
            ServerError::ResourceService { source } => source.to_http_status(),
            ServerError::TokenPropagator { .. } => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ToErrorPresentation for ServerError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            ServerError::CredsManage { source } => source.to_error_presentation(),
            ServerError::Oidc { source } => source.to_error_presentation(),
            ServerError::Creds { source } => source.to_error_presentation(),
            ServerError::SessionContext { source } => source.to_error_presentation(),
            ServerError::SessionAuthService { source } => source.to_error_presentation(),
            ServerError::BasicAuthContextService { source } => source.to_error_presentation(),
            ServerError::BackendOidcRuntime { source } => source.to_error_presentation(),
            ServerError::ResourceService { source } => source.to_error_presentation(),
            ServerError::TokenPropagator { source } => source.to_error_presentation(),
            ServerError::ConfigLoad { .. }
            | ServerError::InvalidConfig { .. }
            | ServerError::ServerBoot { .. } => ErrorPresentation::new(
                "service_unavailable",
                "The service is temporarily unavailable.",
                UserRecovery::ContactSupport,
            ),
        }
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        let status = self.to_http_status();
        let presentation = self.to_error_presentation();

        if status.is_server_error() {
            tracing::error!(
                status = status.as_u16(),
                error_code = presentation.code,
                recovery = ?presentation.recovery,
                internal_error = %self,
                "request failed"
            );
        } else {
            tracing::warn!(
                status = status.as_u16(),
                error_code = presentation.code,
                recovery = ?presentation.recovery,
                internal_error = %self,
                "request failed"
            );
        }

        let body = json!({
            "error": presentation,
            "status": status.as_u16(),
            "success": false
        });
        (status, axum::Json(body)).into_response()
    }
}

pub type ServerResult<T> = std::result::Result<T, ServerError>;
