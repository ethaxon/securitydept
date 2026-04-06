// ---------------------------------------------------------------------------
// Access-token substrate capability axes
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};

use super::propagation::TokenPropagatorConfig;

// ---- Token propagation ----

/// Simple discriminant for token propagation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TokenPropagationKind {
    /// Token propagation is disabled.
    #[default]
    Disabled,
    /// Token propagation is enabled.
    Enabled,
}

/// Whether and how access tokens may be propagated to downstream services.
///
/// `Enabled` carries the `TokenPropagatorConfig`, ensuring propagation policy
/// configuration is always present when the feature is active.
///
/// This capability belongs to the `access_token_substrate` layer, not to any
/// specific OIDC mode.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TokenPropagation {
    /// Token propagation is disabled — no downstream forwarding.
    #[default]
    Disabled,
    /// Token propagation is enabled with the associated policy configuration.
    Enabled {
        #[serde(flatten)]
        config: TokenPropagatorConfig,
    },
}

impl TokenPropagation {
    pub fn kind(&self) -> TokenPropagationKind {
        match self {
            Self::Disabled => TokenPropagationKind::Disabled,
            Self::Enabled { .. } => TokenPropagationKind::Enabled,
        }
    }

    /// Extract the propagator configuration reference when enabled.
    pub fn config(&self) -> Option<&TokenPropagatorConfig> {
        match self {
            Self::Enabled { config } => Some(config),
            Self::Disabled => None,
        }
    }
}
