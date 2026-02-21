use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// Map core and OIDC errors to HTTP responses.
pub enum AppError {
    Core(securitydept_core::error::Error),
    Oidc(securitydept_oidc::OidcError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        use securitydept_core::error::Error;

        let (status, message) = match &self {
            AppError::Core(e) => match e {
                Error::EntryNotFound { .. } | Error::GroupNotFound { .. } => {
                    (StatusCode::NOT_FOUND, e.to_string())
                }
                Error::DuplicateEntryName { .. } | Error::DuplicateGroupName { .. } => {
                    (StatusCode::CONFLICT, e.to_string())
                }
                Error::AuthFailed | Error::SessionNotFound | Error::SessionExpired => {
                    (StatusCode::UNAUTHORIZED, e.to_string())
                }
                Error::InvalidConfig { .. } | Error::ConfigLoad { .. } => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Configuration error".to_string(),
                ),
                _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            },
            AppError::Oidc(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };

        let body = json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}

impl From<securitydept_core::error::Error> for AppError {
    fn from(err: securitydept_core::error::Error) -> Self {
        AppError::Core(err)
    }
}

impl From<securitydept_oidc::OidcError> for AppError {
    fn from(err: securitydept_oidc::OidcError) -> Self {
        AppError::Oidc(err)
    }
}
