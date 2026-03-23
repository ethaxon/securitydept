use axum::{
    body::Body,
    http::{Request, Response},
};
use axum_reverse_proxy::ReverseProxy;
use http::header::AUTHORIZATION;
use url::Url;

use super::{
    config::AxumReverseProxyPropagationForwarderConfig,
    error::AxumReverseProxyPropagationForwarderError,
};
use crate::{
    DEFAULT_PROPAGATION_HEADER_NAME, PropagatedBearer, PropagationRequestTarget, TokenPropagator,
};

#[derive(Debug, Clone)]
pub struct AxumReverseProxyPropagationForwarder {
    config: AxumReverseProxyPropagationForwarderConfig,
}

impl AxumReverseProxyPropagationForwarder {
    pub fn new(
        config: AxumReverseProxyPropagationForwarderConfig,
    ) -> Result<Self, AxumReverseProxyPropagationForwarderError> {
        config.validate()?;
        Ok(Self { config })
    }

    pub fn config(&self) -> &AxumReverseProxyPropagationForwarderConfig {
        &self.config
    }

    pub async fn forward(
        &self,
        propagator: &TokenPropagator,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
        mut request: Request<Body>,
    ) -> Result<Response<Body>, AxumReverseProxyPropagationForwarderError> {
        let authorization_header_value = propagator
            .authorization_header_value(bearer, target)
            .map_err(
                |source| AxumReverseProxyPropagationForwarderError::TokenPropagator { source },
            )?;
        let origin = propagator.resolve_target_origin(target).map_err(|source| {
            AxumReverseProxyPropagationForwarderError::TokenPropagator { source }
        })?;

        prepare_forward_request(authorization_header_value, &mut request);

        let origin = Url::parse(&origin).map_err(|source| {
            AxumReverseProxyPropagationForwarderError::InvalidOrigin { source }
        })?;
        let proxy = ReverseProxy::new(self.config.proxy_path.clone(), origin.to_string());

        let response = proxy
            .proxy_request(request)
            .await
            .expect("reverse proxy is infallible");

        Ok(response)
    }
}

fn prepare_forward_request(
    authorization_header_value: http::HeaderValue,
    request: &mut Request<Body>,
) {
    request
        .headers_mut()
        .remove(DEFAULT_PROPAGATION_HEADER_NAME);
    request
        .headers_mut()
        .insert(AUTHORIZATION, authorization_header_value);
}
