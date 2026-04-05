// ---------------------------------------------------------------------------
// Backend-OIDC capability axes
// ---------------------------------------------------------------------------
//
// Each axis uses the `Feature + FeatureKind` dual-enum pattern:
//
// - `FeatureKind` — simple discriminant for display, telemetry, and presets.
// - `Feature`     — structured enum carrying axis-specific configuration.
//
// `Feature::kind()` bridges the two representations.

use serde::{Deserialize, Serialize};

use super::redirect::BackendOidcModeRedirectUriConfig;

// ---- Refresh material protection ----

/// Simple discriminant for refresh-material protection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RefreshMaterialProtectionKind {
    /// Refresh tokens are passed through without server-side sealing.
    #[default]
    Passthrough,
    /// Refresh tokens are sealed (AEAD-encrypted) by the server.
    Sealed,
}

/// How refresh tokens are stored / transmitted between server and client.
///
/// `Sealed` carries the `master_key` instead of scattering it as a sibling
/// field — the type system guarantees the key is present when sealing is
/// enabled.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RefreshMaterialProtection {
    /// Refresh tokens are passed through without server-side sealing.
    #[default]
    Passthrough,
    /// Refresh tokens are sealed (AEAD-encrypted) by the server.
    Sealed {
        /// The AEAD master key used for sealing and unsealing.
        master_key: String,
    },
}

impl RefreshMaterialProtection {
    pub fn kind(&self) -> RefreshMaterialProtectionKind {
        match self {
            Self::Passthrough => RefreshMaterialProtectionKind::Passthrough,
            Self::Sealed { .. } => RefreshMaterialProtectionKind::Sealed,
        }
    }

    /// Extract the master key reference when in `Sealed` mode.
    pub fn master_key(&self) -> Option<&str> {
        match self {
            Self::Sealed { master_key } => Some(master_key),
            Self::Passthrough => None,
        }
    }
}

// ---- Metadata delivery ----

/// Simple discriminant for metadata delivery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MetadataDeliveryKind {
    /// No server-side metadata delivery.
    #[default]
    None,
    /// Metadata redeemed via one-time id.
    Redemption,
}

/// How auth-state metadata (principal, source) is delivered to the client.
///
/// `Redemption` carries the store configuration, eliminating the need for a
/// separate config field.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MetadataDelivery<MC> {
    /// No server-side metadata delivery — the client extracts what it needs
    /// from the token set itself.
    #[default]
    None,
    /// Metadata is stored server-side and redeemed by the client via a
    /// one-time redemption id included in the callback/refresh fragment.
    Redemption {
        /// Store configuration (e.g. moka cache capacity / TTL).
        #[serde(flatten)]
        config: MC,
    },
}

impl<MC> MetadataDelivery<MC> {
    pub fn kind(&self) -> MetadataDeliveryKind {
        match self {
            Self::None => MetadataDeliveryKind::None,
            Self::Redemption { .. } => MetadataDeliveryKind::Redemption,
        }
    }
}

// ---- Post-auth redirect policy ----

/// Simple discriminant for post-auth redirect policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PostAuthRedirectPolicyKind {
    /// Caller supplies and validates the redirect URI.
    #[default]
    CallerValidated,
    /// Runtime resolves and validates against an allowlist.
    Resolved,
}

/// Who validates the `post_auth_redirect_uri` after callback / refresh.
///
/// `Resolved` carries the redirect policy configuration, ensuring the
/// allowlist config is always present when the resolved policy is selected.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PostAuthRedirectPolicy {
    /// The caller (route / app glue) is responsible for supplying and
    /// validating the redirect URI. The service applies no policy.
    #[default]
    CallerValidated,
    /// The service resolves and validates the redirect URI against an
    /// allowlist / policy configuration owned by the runtime.
    Resolved {
        /// Redirect target configuration (default URL, allowed targets).
        #[serde(flatten)]
        config: BackendOidcModeRedirectUriConfig,
    },
}

impl PostAuthRedirectPolicy {
    pub fn kind(&self) -> PostAuthRedirectPolicyKind {
        match self {
            Self::CallerValidated => PostAuthRedirectPolicyKind::CallerValidated,
            Self::Resolved { .. } => PostAuthRedirectPolicyKind::Resolved,
        }
    }
}

// ---- Composite capabilities (Kind-level) ----

/// The full capability bundle for a `backend-oidc` deployment (Kind level).
///
/// Each field uses the simple discriminant enum. Use this for preset
/// definitions, display, and telemetry — not for config deserialization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendOidcModeCapabilities {
    #[serde(default)]
    pub refresh_material_protection: RefreshMaterialProtectionKind,
    #[serde(default)]
    pub metadata_delivery: MetadataDeliveryKind,
    #[serde(default)]
    pub post_auth_redirect_policy: PostAuthRedirectPolicyKind,
}

impl Default for BackendOidcModeCapabilities {
    fn default() -> Self {
        Self::pure()
    }
}

impl BackendOidcModeCapabilities {
    /// Pure preset: minimal backend OIDC baseline.
    pub fn pure() -> Self {
        Self {
            refresh_material_protection: RefreshMaterialProtectionKind::Passthrough,
            metadata_delivery: MetadataDeliveryKind::None,
            post_auth_redirect_policy: PostAuthRedirectPolicyKind::CallerValidated,
        }
    }

    /// Mediated preset: backend OIDC with custody / policy augmentation.
    pub fn mediated() -> Self {
        Self {
            refresh_material_protection: RefreshMaterialProtectionKind::Sealed,
            metadata_delivery: MetadataDeliveryKind::Redemption,
            post_auth_redirect_policy: PostAuthRedirectPolicyKind::Resolved,
        }
    }
}

/// Named presets for common `backend-oidc` capability bundles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendOidcModePreset {
    /// Minimal backend OIDC baseline.
    Pure,
    /// Backend OIDC with custody / policy augmentation.
    Mediated,
}

impl BackendOidcModePreset {
    /// Expand a preset into its default capability bundle.
    pub fn capabilities(self) -> BackendOidcModeCapabilities {
        match self {
            Self::Pure => BackendOidcModeCapabilities::pure(),
            Self::Mediated => BackendOidcModeCapabilities::mediated(),
        }
    }
}
