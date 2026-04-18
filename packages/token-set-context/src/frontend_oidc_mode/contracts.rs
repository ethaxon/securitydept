//! Cross-boundary contracts for `frontend-oidc` mode.
//!
//! These types define the interop contract between the frontend OIDC browser
//! client and the backend. They are the Rust counterpart of the TS
//! `@securitydept/token-set-context-client/frontend-oidc-mode` contracts.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, SystemTime},
};

use securitydept_oidc_client::transpile_claims_script_typescript_to_javascript;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
struct CachedFrontendClaimsCheckScript {
    modified_at: Option<SystemTime>,
    content: String,
}

static FRONTEND_CLAIMS_CHECK_SCRIPT_CACHE: LazyLock<
    Mutex<HashMap<String, CachedFrontendClaimsCheckScript>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Claims check script
// ---------------------------------------------------------------------------

/// Structured claims check script for the frontend OIDC client.
///
/// The backend resolves the configured file path and embeds the content
/// inline so the browser client never needs to reach the server filesystem.
///
/// This is an extensible enum — future variants (e.g. a signed URL) can be
/// added without breaking existing `Inline` consumers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FrontendOidcModeClaimsCheckScript {
    /// Script content is embedded directly in the projection.
    ///
    /// The backend read the script from the filesystem at projection time
    /// and inlined it here. The browser evaluates `content` directly.
    Inline { content: String },
}

impl FrontendOidcModeClaimsCheckScript {
    /// Read the script from the given filesystem path and wrap it as `Inline`.
    pub async fn from_path(path: &str) -> std::io::Result<Self> {
        let modified_at = tokio::fs::metadata(path)
            .await
            .ok()
            .and_then(|metadata| metadata.modified().ok());

        if let Some(cached) = FRONTEND_CLAIMS_CHECK_SCRIPT_CACHE
            .lock()
            .expect("frontend claims-check cache poisoned")
            .get(path)
            .cloned()
            .filter(|cached| cached.modified_at == modified_at)
        {
            return Ok(Self::Inline {
                content: cached.content,
            });
        }

        let mut content = tokio::fs::read_to_string(path).await?;
        if matches!(
            std::path::Path::new(path)
                .extension()
                .and_then(|ext| ext.to_str()),
            Some("ts" | "mts")
        ) {
            content = transpile_claims_script_typescript_to_javascript(path, &content)
                .await
                .map_err(|error| std::io::Error::other(error.to_string()))?;
        }

        FRONTEND_CLAIMS_CHECK_SCRIPT_CACHE
            .lock()
            .expect("frontend claims-check cache poisoned")
            .insert(
                path.to_string(),
                CachedFrontendClaimsCheckScript {
                    modified_at,
                    content: content.clone(),
                },
            );

        Ok(Self::Inline { content })
    }

    /// The script content, regardless of variant.
    pub fn content(&self) -> &str {
        match self {
            Self::Inline { content } => content,
        }
    }
}

// ---------------------------------------------------------------------------
// Config projection
// ---------------------------------------------------------------------------

/// Backend-to-frontend OIDC configuration projection.
///
/// When a deployment uses `frontend-oidc` mode, the backend must tell the
/// browser client *which* OIDC provider to talk to and *how*. This struct
/// faithfully reflects the resolved `OidcClientConfig` minus server-only
/// fields (`pending_store`, `device_poll_interval`).
///
/// `client_secret` is **omitted by default** for security — it is only
/// included when the [`UnsafeFrontendClientSecret`] capability is enabled.
///
/// The frontend OIDC client uses this to initialize its own `oauth4webapi`
/// session — either via discovery (`well_known_url`) or via manual endpoint
/// overrides.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrontendOidcModeConfigProjection {
    // --- Provider connectivity (from OAuthProviderRemoteConfig) ---
    /// OIDC discovery URL (e.g. `https://auth.example.com/.well-known/openid-configuration`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub well_known_url: Option<String>,
    /// Issuer URL. When `well_known_url` is set, this is derived from
    /// discovery; when not, the frontend should use this directly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer_url: Option<String>,
    /// JWKS URI for direct key fetching without discovery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jwks_uri: Option<String>,
    /// How often the frontend should refresh provider discovery metadata.
    /// `0` means no periodic refresh.
    #[serde(
        default,
        skip_serializing_if = "Duration::is_zero",
        with = "humantime_serde"
    )]
    pub metadata_refresh_interval: Duration,
    /// How often the frontend should refresh the remote JWKS.
    /// `0` means no time-based refresh.
    #[serde(
        default,
        skip_serializing_if = "Duration::is_zero",
        with = "humantime_serde"
    )]
    pub jwks_refresh_interval: Duration,

    // --- Provider OIDC endpoints (from OAuthProviderOidcConfig) ---
    /// Authorization endpoint override. `None` means "derived from discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_endpoint: Option<String>,
    /// Token endpoint override. `None` means "derived from discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_endpoint: Option<String>,
    /// UserInfo endpoint override. `None` means "derived from discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub userinfo_endpoint: Option<String>,
    /// Revocation endpoint override. `None` means "derived from discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revocation_endpoint: Option<String>,
    /// Supported token endpoint authentication methods.
    /// `None` means "use provider discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_endpoint_auth_methods_supported: Option<Vec<String>>,
    /// Supported algorithms for signing ID tokens.
    /// `None` means "use provider discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token_signing_alg_values_supported: Option<Vec<String>>,
    /// Supported algorithms for signing UserInfo responses.
    /// `None` means "use provider discovery."
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub userinfo_signing_alg_values_supported: Option<Vec<String>>,
    /// The `client_id` the frontend should use for authorization requests.
    pub client_id: String,
    /// **Unsafe.** Only populated when `UnsafeFrontendClientSecret` capability
    /// is enabled. Exposing secrets to the browser is a security anti-pattern;
    /// this exists solely for broken providers that require it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    /// Scopes the frontend should request (e.g. `["openid", "profile",
    /// "email"]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scopes: Vec<String>,
    /// Scopes that MUST be present in the token endpoint response.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_scopes: Vec<String>,
    /// The redirect URL the frontend should use for the OIDC callback.
    pub redirect_url: String,
    /// Whether PKCE is enabled for the authorization code flow.
    #[serde(default)]
    pub pkce_enabled: bool,
    /// Claims check script for client-side evaluation.
    ///
    /// The backend reads the script from the configured filesystem path and
    /// inlines the content here so the browser never needs to reach the server
    /// filesystem directly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claims_check_script: Option<FrontendOidcModeClaimsCheckScript>,

    /// Epoch-millisecond timestamp of when this projection was generated by
    /// the backend. This is the **authoritative freshness signal** for all
    /// downstream sources (bootstrap_script, persisted, network).
    ///
    /// Clients compare this against a max-age policy to decide whether an
    /// idle revalidation is needed.
    pub generated_at: u64,
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[tokio::test]
    async fn from_path_handles_typescript_claims_check_scripts_explicitly() {
        let path = std::env::temp_dir().join(format!(
            "securitydept-frontend-claims-check-{}.mts",
            uuid::Uuid::new_v4()
        ));
        fs::write(
            &path,
            r#"
                interface Claims { sub: string; }
                export default function claimsCheck(idTokenClaims: Claims) {
                    return { success: true, display_name: idTokenClaims.sub, claims: idTokenClaims };
                }
            "#,
        )
        .expect("write temp claims script");

        let result = FrontendOidcModeClaimsCheckScript::from_path(
            path.to_str().expect("temp path should be utf-8"),
        )
        .await;

        match result {
            Ok(FrontendOidcModeClaimsCheckScript::Inline { content }) => {
                assert!(
                    !content.contains("interface Claims"),
                    "typescript-only syntax should be removed from the inlined script"
                );
                assert!(
                    content.contains("export default function claimsCheck"),
                    "transpiled script should still expose the claimsCheck entrypoint"
                );
                assert!(
                    content.contains("display_name: idTokenClaims.sub"),
                    "transpiled script should preserve the claims-check logic"
                );
            }
            Err(error) => {
                assert!(
                    error
                        .to_string()
                        .contains("claims-script feature to be enabled"),
                    "typescript claims script loading should fail with an explicit feature error \
                     when transpilation support is unavailable: {error}"
                );
            }
        }

        let _ = fs::remove_file(path);
    }
}
