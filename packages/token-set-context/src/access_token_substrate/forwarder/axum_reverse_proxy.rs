use axum::{
    body::Body,
    http::{Request, Response},
};
use axum_reverse_proxy::ReverseProxy;
use http::header::AUTHORIZATION;
use serde::{Deserialize, Serialize};
use typed_builder::TypedBuilder;
use url::Url;

use super::{
    super::{
        DEFAULT_PROPAGATION_HEADER_NAME, PropagatedBearer, PropagationRequestTarget,
        TokenPropagator,
    },
    error::PropagationForwarderError,
};

fn default_proxy_path() -> String {
    "/".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AxumReverseProxyPropagationForwarderConfig {
    #[builder(default = default_proxy_path())]
    #[serde(default = "default_proxy_path")]
    pub proxy_path: String,
}

impl Default for AxumReverseProxyPropagationForwarderConfig {
    fn default() -> Self {
        Self {
            proxy_path: default_proxy_path(),
        }
    }
}

impl AxumReverseProxyPropagationForwarderConfig {
    pub fn validate(&self) -> Result<(), PropagationForwarderError> {
        if self.proxy_path.is_empty() || !self.proxy_path.starts_with('/') {
            return Err(PropagationForwarderError::Config {
                message: "proxy_path must start with `/`".to_string(),
            });
        }

        Ok(())
    }
}

impl super::PropagationForwarderConfigSource for AxumReverseProxyPropagationForwarderConfig {
    type Forwarder = super::AxumReverseProxyPropagationForwarder;
    type Error = PropagationForwarderError;

    fn build_forwarder(&self) -> Result<Self::Forwarder, Self::Error> {
        super::AxumReverseProxyPropagationForwarder::new(self.clone())
    }
}

#[derive(Debug, Clone)]
pub struct AxumReverseProxyPropagationForwarder {
    config: AxumReverseProxyPropagationForwarderConfig,
}

impl AxumReverseProxyPropagationForwarder {
    pub fn new(
        config: AxumReverseProxyPropagationForwarderConfig,
    ) -> Result<Self, PropagationForwarderError> {
        config.validate()?;
        Ok(Self { config })
    }

    pub fn config(&self) -> &AxumReverseProxyPropagationForwarderConfig {
        &self.config
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

impl super::PropagationForwarder for AxumReverseProxyPropagationForwarder {
    type Body = Body;

    async fn forward(
        &self,
        propagator: &TokenPropagator,
        bearer: &PropagatedBearer<'_>,
        target: &PropagationRequestTarget,
        mut request: Request<Body>,
    ) -> Result<Response<Body>, PropagationForwarderError> {
        let authorization_header_value = propagator
            .authorization_header_value(bearer, target)
            .map_err(|source| PropagationForwarderError::TokenPropagator { source })?;
        let origin = propagator
            .resolve_target_origin(target)
            .map_err(|source| PropagationForwarderError::TokenPropagator { source })?;

        prepare_forward_request(authorization_header_value, &mut request);

        let origin = Url::parse(&origin)
            .map_err(|source| PropagationForwarderError::InvalidOrigin { source })?;
        let proxy = ReverseProxy::new(self.config.proxy_path.clone(), origin.to_string());

        let response = proxy
            .proxy_request(request)
            .await
            .expect("reverse proxy is infallible");

        Ok(response)
    }
}
