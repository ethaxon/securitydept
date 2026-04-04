use serde::{Deserialize, Serialize};
use typed_builder::TypedBuilder;

use super::error::AxumReverseProxyPropagationForwarderError;

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
    pub fn validate(&self) -> Result<(), AxumReverseProxyPropagationForwarderError> {
        if self.proxy_path.is_empty() || !self.proxy_path.starts_with('/') {
            return Err(AxumReverseProxyPropagationForwarderError::Config {
                message: "proxy_path must start with `/`".to_string(),
            });
        }

        Ok(())
    }
}
