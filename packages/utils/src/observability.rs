use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthFlowDiagnosisOutcome {
    Started,
    Succeeded,
    Failed,
    Rejected,
}

impl AuthFlowDiagnosisOutcome {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AuthFlowDiagnosis {
    pub operation: String,
    pub outcome: AuthFlowDiagnosisOutcome,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub fields: Map<String, Value>,
}

impl AuthFlowDiagnosis {
    pub fn new(operation: impl Into<String>, outcome: AuthFlowDiagnosisOutcome) -> Self {
        Self {
            operation: operation.into(),
            outcome,
            fields: Map::new(),
        }
    }

    pub fn started(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Started)
    }

    pub fn succeeded(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Succeeded)
    }

    pub fn failed(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Failed)
    }

    pub fn rejected(operation: impl Into<String>) -> Self {
        Self::new(operation, AuthFlowDiagnosisOutcome::Rejected)
    }

    pub fn with_outcome(mut self, outcome: AuthFlowDiagnosisOutcome) -> Self {
        self.outcome = outcome;
        self
    }

    pub fn field<V>(mut self, key: impl Into<String>, value: V) -> Self
    where
        V: Serialize,
    {
        if let Ok(value) = serde_json::to_value(value) {
            self.fields.insert(key.into(), value);
        }
        self
    }

    pub fn to_json_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| Value::Null)
    }
}

#[derive(Debug)]
pub struct DiagnosedResult<T, E> {
    diagnosis: AuthFlowDiagnosis,
    result: Result<T, E>,
}

impl<T, E> DiagnosedResult<T, E> {
    pub fn success(diagnosis: AuthFlowDiagnosis, value: T) -> Self {
        Self {
            diagnosis,
            result: Ok(value),
        }
    }

    pub fn failure(diagnosis: AuthFlowDiagnosis, error: E) -> Self {
        Self {
            diagnosis,
            result: Err(error),
        }
    }

    pub fn diagnosis(&self) -> &AuthFlowDiagnosis {
        &self.diagnosis
    }

    pub fn result(&self) -> &Result<T, E> {
        &self.result
    }

    pub fn into_result(self) -> Result<T, E> {
        self.result
    }

    pub fn into_parts(self) -> (AuthFlowDiagnosis, Result<T, E>) {
        (self.diagnosis, self.result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnosis_serializes_operation_outcome_and_fields() {
        let diagnosis = AuthFlowDiagnosis::started("projection.config_fetch")
            .field("mode", "frontend_oidc")
            .field("pkce_enabled", true);

        let value = diagnosis.to_json_value();
        assert_eq!(value["operation"], "projection.config_fetch");
        assert_eq!(value["outcome"], "started");
        assert_eq!(value["fields"]["mode"], "frontend_oidc");
        assert_eq!(value["fields"]["pkce_enabled"], true);
    }

    #[test]
    fn diagnosed_result_preserves_diagnosis_on_failure() {
        let diagnosed = DiagnosedResult::<(), &str>::failure(
            AuthFlowDiagnosis::failed("propagation.forward").field("reason", "missing_header"),
            "boom",
        );

        assert!(diagnosed.result().is_err());
        assert_eq!(diagnosed.diagnosis().operation, "propagation.forward");
        assert_eq!(diagnosed.diagnosis().fields["reason"], "missing_header");
    }
}
