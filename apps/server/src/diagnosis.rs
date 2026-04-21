use std::fmt::Display;

use securitydept_core::utils::observability::{AuthFlowDiagnosis, AuthFlowDiagnosisOutcome};
use tracing::{info, warn};

#[derive(Debug, Clone, Copy)]
pub struct RouteDiagnosisContext<'a> {
    pub route: &'a str,
    pub method: &'a str,
    pub status: Option<u16>,
}

pub fn log_route_diagnosis(
    context: RouteDiagnosisContext<'_>,
    diagnosis: &AuthFlowDiagnosis,
    message: &str,
) {
    match diagnosis.outcome {
        AuthFlowDiagnosisOutcome::Failed | AuthFlowDiagnosisOutcome::Rejected => warn!(
            route = context.route,
            method = context.method,
            status = ?context.status,
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "{message}"
        ),
        AuthFlowDiagnosisOutcome::Started | AuthFlowDiagnosisOutcome::Succeeded => info!(
            route = context.route,
            method = context.method,
            status = ?context.status,
            operation = %diagnosis.operation,
            outcome = diagnosis.outcome.as_str(),
            diagnosis = %diagnosis.to_json_value(),
            "{message}"
        ),
    }
}

pub fn log_route_diagnosis_error<E>(
    context: RouteDiagnosisContext<'_>,
    diagnosis: &AuthFlowDiagnosis,
    error: &E,
    message: &str,
) where
    E: Display,
{
    warn!(
        route = context.route,
        method = context.method,
        status = ?context.status,
        operation = %diagnosis.operation,
        outcome = diagnosis.outcome.as_str(),
        diagnosis = %diagnosis.to_json_value(),
        error = %error,
        "{message}"
    );
}
