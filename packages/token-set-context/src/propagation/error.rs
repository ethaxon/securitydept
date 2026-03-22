use securitydept_utils::error::{ErrorPresentation, ToErrorPresentation, UserRecovery};
use snafu::Snafu;

use super::config::BearerPropagationPolicy;

#[derive(Debug, Snafu)]
pub enum TokenPropagatorError {
    #[snafu(display("token propagator is misconfigured: {message}"))]
    PropagatorConfig { message: String },
    #[snafu(display(
        "token propagation policy `{policy:?}` cannot attach an authorization header directly"
    ))]
    UnsupportedDirectAuthorization { policy: BearerPropagationPolicy },
    #[snafu(display("authorization header value is invalid: {source}"))]
    InvalidHeaderValue {
        source: http::header::InvalidHeaderValue,
    },
    #[snafu(display("propagation directive is invalid: {message}"))]
    InvalidPropagationDirective { message: String },
    #[snafu(display("propagation target uses unsupported scheme `{scheme}`"))]
    UnsupportedTargetScheme { scheme: String },
    #[snafu(display("propagation target `{target}` is incomplete"))]
    IncompleteTarget { target: String },
    #[snafu(display("propagation target for node `{node_id}` requires a node target resolver"))]
    NodeTargetResolverRequired { node_id: String },
    #[snafu(display("propagation target for node `{node_id}` could not be resolved"))]
    NodeTargetUnresolved { node_id: String },
    #[snafu(display("propagation target host `{host}` is invalid"))]
    InvalidTargetHost { host: String },
    #[snafu(display("propagation target `{target}` is not allowed"))]
    DestinationNotAllowed { target: String },
    #[snafu(display(
        "propagation target host `{host}` is a sensitive IP literal and is not allowed"
    ))]
    SensitiveIpLiteralDenied { host: String },
    #[snafu(display("propagation CIDR `{cidr}` is invalid"))]
    InvalidCidr { cidr: String },
    #[snafu(display("propagated token issuer `{issuer}` is not allowed"))]
    TokenIssuerNotAllowed { issuer: String },
    #[snafu(display(
        "propagated token facts are unavailable; resource_token_principal is required for \
         validation"
    ))]
    TokenFactsUnavailable,
    #[snafu(display("propagated token is missing an allowed audience"))]
    TokenAudienceNotAllowed,
    #[snafu(display("propagated token is missing required scope `{scope}`"))]
    TokenScopeMissing { scope: String },
    #[snafu(display("propagated token azp `{azp}` is not allowed"))]
    TokenAzpNotAllowed { azp: String },
}

impl ToErrorPresentation for TokenPropagatorError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        ErrorPresentation::new(
            "propagation_context_invalid",
            format!("The propagation header is invalid: {self}"),
            UserRecovery::Retry,
        )
    }
}

pub type TokenPropagatorResult<T> = Result<T, TokenPropagatorError>;
