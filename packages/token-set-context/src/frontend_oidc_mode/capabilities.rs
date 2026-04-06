//! Capability axes for `frontend-oidc` mode.
//!
//! Each capability is a deliberate opt-in that relaxes a security default
//! or enables a non-standard behaviour. The server logs a warning at startup
//! for every unsafe capability that is enabled.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// UnsafeFrontendClientSecret
// ---------------------------------------------------------------------------

/// When enabled, the backend includes `client_secret` in the
/// [`FrontendOidcModeConfigProjection`](super::contracts::FrontendOidcModeConfigProjection)
/// served to the browser.
///
/// # Security implications
///
/// OAuth 2.0 public clients (browsers, SPAs) are **not** meant to hold
/// secrets. Exposing `client_secret` to the frontend:
///
/// - negates the confidentiality of the credential
/// - allows any user to impersonate the RP
/// - violates RFC 6749 §2.1 / RFC 8252
///
/// This capability exists **only** as a compatibility escape hatch for
/// broken or misconfigured OIDC providers that refuse public-client
/// registrations.
///
/// When enabled, both the server (at startup) and the frontend client (at
/// initialisation) should emit a prominent warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum UnsafeFrontendClientSecret {
    /// Client secret is **not** exposed to the frontend (default, safe).
    #[default]
    Disabled,
    /// Client secret **is** included in the config projection.
    ///
    /// ⚠️ This is **unsafe**. Use only when the OIDC provider cannot be
    /// configured for public-client flows.
    Enabled,
}

impl UnsafeFrontendClientSecret {
    /// Returns `true` when the capability is active.
    pub fn is_enabled(self) -> bool {
        matches!(self, Self::Enabled)
    }

    /// Log a warning if the capability is enabled.
    ///
    /// Call this at server startup so operators are aware.
    pub fn warn_if_enabled(self) {
        if self.is_enabled() {
            tracing::warn!(
                capability = "UnsafeFrontendClientSecret",
                "⚠️  SECURITY WARNING: the frontend-oidc client_secret capability is ENABLED. The \
                 OIDC client secret will be exposed to the browser. This is a security \
                 anti-pattern and should only be used as a compatibility workaround for \
                 misconfigured OIDC providers."
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Aggregate capabilities
// ---------------------------------------------------------------------------

/// All capability axes for `frontend-oidc` mode.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FrontendOidcModeCapabilities {
    /// Whether to expose `client_secret` to the frontend browser client.
    #[serde(default)]
    pub unsafe_frontend_client_secret: UnsafeFrontendClientSecret,
}

impl FrontendOidcModeCapabilities {
    /// Log warnings for all enabled unsafe capabilities.
    ///
    /// Call this once at server startup.
    pub fn warn_unsafe(&self) {
        self.unsafe_frontend_client_secret.warn_if_enabled();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_capabilities_are_safe() {
        let caps = FrontendOidcModeCapabilities::default();
        assert!(!caps.unsafe_frontend_client_secret.is_enabled());
    }

    #[test]
    fn enabled_capability_is_detected() {
        let caps = FrontendOidcModeCapabilities {
            unsafe_frontend_client_secret: UnsafeFrontendClientSecret::Enabled,
        };
        assert!(caps.unsafe_frontend_client_secret.is_enabled());
    }

    #[test]
    fn deserialize_from_toml_style_json() {
        let json = serde_json::json!({
            "unsafe_frontend_client_secret": "enabled"
        });
        let caps: FrontendOidcModeCapabilities =
            serde_json::from_value(json).expect("should deserialize");
        assert!(caps.unsafe_frontend_client_secret.is_enabled());
    }

    #[test]
    fn deserialize_defaults_to_disabled() {
        let json = serde_json::json!({});
        let caps: FrontendOidcModeCapabilities =
            serde_json::from_value(json).expect("should deserialize");
        assert!(!caps.unsafe_frontend_client_secret.is_enabled());
    }
}
