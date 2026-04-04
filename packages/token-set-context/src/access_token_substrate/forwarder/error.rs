use securitydept_utils::error::{ErrorPresentation, ToErrorPresentation, UserRecovery};
use snafu::Snafu;

use super::super::TokenPropagatorError;

#[derive(Debug, Snafu)]
pub enum AxumReverseProxyPropagationForwarderError {
    #[snafu(display("axum reverse proxy propagation forwarder is misconfigured: {message}"))]
    Config { message: String },
    #[snafu(display("token propagation failed: {source}"), context(false))]
    TokenPropagator { source: TokenPropagatorError },
    #[snafu(display("resolved propagation target origin is invalid: {source}"))]
    InvalidOrigin { source: url::ParseError },
}

pub type AxumReverseProxyPropagationForwarderResult<T> =
    Result<T, AxumReverseProxyPropagationForwarderError>;

impl ToErrorPresentation for AxumReverseProxyPropagationForwarderError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            Self::Config { .. } => ErrorPresentation::new(
                "propagation_forwarder_config_invalid",
                "The propagation forwarder is misconfigured.",
                UserRecovery::ContactSupport,
            ),
            Self::TokenPropagator { source } => source.to_error_presentation(),
            Self::InvalidOrigin { .. } => ErrorPresentation::new(
                "propagation_forwarder_invalid_origin",
                "The propagation target URL is invalid.",
                UserRecovery::ContactSupport,
            ),
        }
    }
}
