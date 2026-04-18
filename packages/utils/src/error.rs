use std::borrow::Cow;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UserRecovery {
    None,
    Retry,
    RestartFlow,
    Reauthenticate,
    ContactSupport,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorPresentation {
    pub code: &'static str,
    pub message: Cow<'static, str>,
    pub recovery: UserRecovery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerErrorKind {
    InvalidRequest,
    Unauthenticated,
    Unauthorized,
    Conflict,
    Unavailable,
    Internal,
}

impl ServerErrorKind {
    pub const fn from_http_status(status: u16) -> Self {
        match status {
            400 | 404 | 422 => Self::InvalidRequest,
            401 => Self::Unauthenticated,
            403 => Self::Unauthorized,
            409 => Self::Conflict,
            503 => Self::Unavailable,
            _ if status >= 500 => Self::Internal,
            _ => Self::InvalidRequest,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ServerErrorDescriptor {
    pub kind: ServerErrorKind,
    pub code: &'static str,
    pub message: Cow<'static, str>,
    pub recovery: UserRecovery,
    pub retryable: bool,
    pub presentation: ErrorPresentation,
}

impl ServerErrorDescriptor {
    pub fn new(kind: ServerErrorKind, presentation: ErrorPresentation) -> Self {
        let retryable = presentation.recovery == UserRecovery::Retry;
        Self {
            kind,
            code: presentation.code,
            message: presentation.message.clone(),
            recovery: presentation.recovery,
            retryable,
            presentation,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ServerErrorEnvelope {
    pub success: bool,
    pub status: u16,
    pub error: ServerErrorDescriptor,
}

impl ServerErrorEnvelope {
    pub fn new(status: u16, error: ServerErrorDescriptor) -> Self {
        Self {
            success: false,
            status,
            error,
        }
    }
}

impl ErrorPresentation {
    pub fn new(
        code: &'static str,
        message: impl Into<Cow<'static, str>>,
        recovery: UserRecovery,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            recovery,
        }
    }
}

pub trait ToErrorPresentation {
    fn to_error_presentation(&self) -> ErrorPresentation;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_error_kind_derives_from_status() {
        assert_eq!(
            ServerErrorKind::from_http_status(401),
            ServerErrorKind::Unauthenticated
        );
        assert_eq!(
            ServerErrorKind::from_http_status(409),
            ServerErrorKind::Conflict
        );
        assert_eq!(
            ServerErrorKind::from_http_status(503),
            ServerErrorKind::Unavailable
        );
    }

    #[test]
    fn server_error_descriptor_preserves_dual_layer_fields() {
        let descriptor = ServerErrorDescriptor::new(
            ServerErrorKind::InvalidRequest,
            ErrorPresentation::new(
                "token_set_frontend.redirect_uri_invalid",
                "The redirect URL is invalid.",
                UserRecovery::RestartFlow,
            ),
        );

        assert_eq!(descriptor.kind, ServerErrorKind::InvalidRequest);
        assert_eq!(descriptor.code, "token_set_frontend.redirect_uri_invalid");
        assert_eq!(descriptor.recovery, UserRecovery::RestartFlow);
        assert_eq!(descriptor.presentation.code, descriptor.code);
        assert!(!descriptor.retryable);
    }
}
