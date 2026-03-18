use http::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use snafu::Snafu;
use typed_builder::TypedBuilder;

use crate::AuthStateSnapshot;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BearerPropagationPolicy {
    TransparentForward,
    ValidateThenForward,
    ExchangeForDownstreamToken,
}

pub(crate) fn default_bearer_propagation_policy() -> BearerPropagationPolicy {
    BearerPropagationPolicy::ValidateThenForward
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct TokenPropagatorConfig {
    #[builder(default = BearerPropagationPolicy::ValidateThenForward)]
    #[serde(default = "default_bearer_propagation_policy")]
    pub default_policy: BearerPropagationPolicy,
    #[builder(default)]
    #[serde(default)]
    pub trust_auth_state_policy: bool,
}

impl Default for TokenPropagatorConfig {
    fn default() -> Self {
        Self {
            default_policy: default_bearer_propagation_policy(),
            trust_auth_state_policy: false,
        }
    }
}

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
}

#[derive(Debug, Clone)]
pub struct TokenPropagator {
    default_policy: BearerPropagationPolicy,
    trust_auth_state_policy: bool,
}

impl TokenPropagatorConfig {
    pub fn validate(&self) -> Result<(), TokenPropagatorError> {
        Ok(())
    }
}

impl TokenPropagator {
    pub fn from_config(config: &TokenPropagatorConfig) -> Result<Self, TokenPropagatorError> {
        config.validate()?;

        Ok(Self {
            default_policy: config.default_policy.clone(),
            trust_auth_state_policy: config.trust_auth_state_policy,
        })
    }

    pub fn policy(&self) -> &BearerPropagationPolicy {
        &self.default_policy
    }

    pub fn resolve_policy(&self, auth_state: &AuthStateSnapshot) -> BearerPropagationPolicy {
        if self.trust_auth_state_policy {
            auth_state.metadata.bearer_propagation_policy.clone()
        } else {
            self.default_policy.clone()
        }
    }

    pub fn authorization_value(
        &self,
        auth_state: &AuthStateSnapshot,
    ) -> Result<String, TokenPropagatorError> {
        match self.resolve_policy(auth_state) {
            BearerPropagationPolicy::TransparentForward
            | BearerPropagationPolicy::ValidateThenForward => {
                Ok(auth_state.tokens.authorization_value())
            }
            BearerPropagationPolicy::ExchangeForDownstreamToken => {
                Err(TokenPropagatorError::UnsupportedDirectAuthorization {
                    policy: BearerPropagationPolicy::ExchangeForDownstreamToken,
                })
            }
        }
    }

    pub fn authorization_header_value(
        &self,
        auth_state: &AuthStateSnapshot,
    ) -> Result<HeaderValue, TokenPropagatorError> {
        let authorization_value = self.authorization_value(auth_state)?;

        HeaderValue::from_str(&authorization_value)
            .map_err(|source| TokenPropagatorError::InvalidHeaderValue { source })
    }

    pub fn apply_authorization_header(
        &self,
        auth_state: &AuthStateSnapshot,
        headers: &mut HeaderMap,
    ) -> Result<(), TokenPropagatorError> {
        headers.insert(AUTHORIZATION, self.authorization_header_value(auth_state)?);
        Ok(())
    }
}
