use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// Map core errors to HTTP responses.
pub struct AppError(pub securitydept_core::error::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        use securitydept_core::error::Error;

        let (status, message) = match &self.0 {
            Error::EntryNotFound { .. } | Error::GroupNotFound { .. } => {
                (StatusCode::NOT_FOUND, self.0.to_string())
            }
            Error::DuplicateEntryName { .. } | Error::DuplicateGroupName { .. } => {
                (StatusCode::CONFLICT, self.0.to_string())
            }
            Error::AuthFailed | Error::SessionNotFound | Error::SessionExpired => {
                (StatusCode::UNAUTHORIZED, self.0.to_string())
            }
            Error::ClaimsCheckFailed { .. } => (StatusCode::FORBIDDEN, self.0.to_string()),
            Error::InvalidConfig { .. } | Error::ConfigLoad { .. } => {
                (StatusCode::INTERNAL_SERVER_ERROR, "Configuration error".to_string())
            }
            _ => (StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()),
        };

        let body = json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}

impl From<securitydept_core::error::Error> for AppError {
    fn from(err: securitydept_core::error::Error) -> Self {
        Self(err)
    }
}
