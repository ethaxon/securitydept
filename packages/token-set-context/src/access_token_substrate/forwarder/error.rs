use securitydept_utils::error::{ErrorPresentation, ToErrorPresentation, UserRecovery};
use snafu::Snafu;

use super::super::TokenPropagatorError;

/// Error type for propagation forwarders.
///
/// This type is framework-agnostic; concrete forwarder implementations
/// (e.g. `AxumReverseProxyPropagationForwarder`) use it as their error variant.
#[derive(Debug, Snafu)]
pub enum PropagationForwarderError {
    #[snafu(display("propagation forwarder is misconfigured: {message}"))]
    Config { message: String },
    #[snafu(display("token propagation failed: {source}"), context(false))]
    TokenPropagator { source: TokenPropagatorError },
    #[snafu(display("resolved propagation target origin is invalid: {source}"))]
    InvalidOrigin { source: url::ParseError },
}

pub type PropagationForwarderResult<T> = Result<T, PropagationForwarderError>;

impl ToErrorPresentation for PropagationForwarderError {
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
