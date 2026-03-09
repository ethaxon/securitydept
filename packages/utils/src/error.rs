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
