use snafu::Snafu;

use crate::TokenPropagatorError;

#[derive(Debug, Snafu)]
pub enum AxumReverseProxyPropagationForwarderError {
    #[snafu(display("axum reverse proxy propagation forwarder is misconfigured: {message}"))]
    Config { message: String },
    #[snafu(display("token propagation failed: {source}"), context(false))]
    TokenPropagator { source: TokenPropagatorError },
    #[snafu(display("resolved propagation target origin is invalid: {source}"))]
    InvalidOrigin { source: url::ParseError },
}
