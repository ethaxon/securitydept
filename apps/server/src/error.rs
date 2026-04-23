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
        error::{
            ErrorPresentation, ServerErrorDescriptor, ServerErrorEnvelope, ServerErrorKind,
            ToErrorPresentation, UserRecovery,
        },
        http::ToHttpStatus,
    },
};
use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum ServerError {
    #[snafu(display("Failed to load config: {message}"))]
    ConfigLoad { message: String },
    #[snafu(display("Invalid configuration: {message}"))]
    InvalidConfig { message: String },
    #[snafu(display("{message}"))]
    RoutePresentation {
        status: StatusCode,
        presentation: ErrorPresentation,
        message: String,
    },
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
            ServerError::Creds { source } => source.to_http_status(),
            ServerError::CredsManage { source } => source.to_http_status(),
            ServerError::Oidc { source } => source.to_http_status(),
            ServerError::RoutePresentation { status, .. } => *status,
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
            ServerError::RoutePresentation { presentation, .. } => presentation.clone(),
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

impl ServerError {
    pub fn route_presentation(
        status: StatusCode,
        presentation: ErrorPresentation,
        message: impl Into<String>,
    ) -> Self {
        Self::RoutePresentation {
            status,
            presentation,
            message: message.into(),
        }
    }

    fn to_server_error_kind(
        &self,
        status: StatusCode,
        presentation: &ErrorPresentation,
    ) -> ServerErrorKind {
        match self {
            ServerError::ConfigLoad { .. }
            | ServerError::InvalidConfig { .. }
            | ServerError::ServerBoot { .. } => ServerErrorKind::Unavailable,
            _ if presentation.code == "service_unavailable" => ServerErrorKind::Unavailable,
            _ => ServerErrorKind::from_http_status(status.as_u16()),
        }
    }

    fn to_server_error_descriptor(&self, status: StatusCode) -> ServerErrorDescriptor {
        let presentation = self.to_error_presentation();
        let kind = self.to_server_error_kind(status, &presentation);
        ServerErrorDescriptor::new(kind, presentation)
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        let status = self.to_http_status();
        let error = self.to_server_error_descriptor(status);

        if status.is_server_error() {
            tracing::error!(
                status = status.as_u16(),
                error_kind = ?error.kind,
                error_code = error.code,
                recovery = ?error.recovery,
                internal_error = %self,
                "request failed"
            );
        } else {
            tracing::warn!(
                status = status.as_u16(),
                error_kind = ?error.kind,
                error_code = error.code,
                recovery = ?error.recovery,
                internal_error = %self,
                "request failed"
            );
        }

        let body = ServerErrorEnvelope::new(status.as_u16(), error);
        (status, axum::Json(body)).into_response()
    }
}

pub type ServerResult<T> = std::result::Result<T, ServerError>;

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    #[tokio::test]
    async fn route_presentation_errors_serialize_as_shared_server_error_envelope() {
        let response = ServerError::route_presentation(
            StatusCode::UNAUTHORIZED,
            ErrorPresentation::new(
                "backend_oidc_mode.bearer_token_required",
                "A bearer access token is required for this endpoint.",
                UserRecovery::Reauthenticate,
            ),
            "Missing or invalid Authorization: Bearer header",
        )
        .into_response();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body should be readable");
        let envelope: serde_json::Value =
            serde_json::from_slice(&body).expect("response should be valid json");

        assert_eq!(envelope["success"], false);
        assert_eq!(envelope["status"], 401);
        assert_eq!(envelope["error"]["kind"], "unauthenticated");
        assert_eq!(
            envelope["error"]["code"],
            "backend_oidc_mode.bearer_token_required"
        );
        assert_eq!(envelope["error"]["recovery"], "reauthenticate");
    }
}
