use openidconnect::core::{CoreClientAuthMethod, CoreJwsSigningAlgorithm};
use serde::Deserialize;
use serde_with::{DeserializeAs, NoneAsEmptyString, PickFirst, serde_as};

#[cfg(feature = "default-pending-store")]
use crate::pending_store::MokaPendingOauthStoreConfig;
use crate::{OidcError, OidcResult};

/// Deserializes a string into Vec<T> by splitting on comma and/or whitespace.
/// Used with PickFirst to accept either a delimited string or a sequence
/// (array).
pub struct CommaOrSpaceSeparated<T>(std::marker::PhantomData<T>);

impl<'de, T> DeserializeAs<'de, Vec<T>> for CommaOrSpaceSeparated<T>
where
    T: serde::de::DeserializeOwned,
{
    fn deserialize_as<D>(deserializer: D) -> std::result::Result<Vec<T>, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.split(|c: char| c == ',' || c.is_whitespace())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|part| {
                let quoted =
                    serde_json::to_string(part).map_err(<D::Error as serde::de::Error>::custom)?;
                serde_json::from_str::<T>(&quoted).map_err(<D::Error as serde::de::Error>::custom)
            })
            .collect()
    }
}

/// Input configuration for building the OIDC client.
///
/// When `well_known_url` is set, discovery is fetched from it and optional
/// fields override. When not set, `issuer_url`, `authorization_endpoint`,
/// `token_endpoint`, and `jwks_uri` must be set. `userinfo_endpoint` is
/// recommended, and userinfo claims are fetched only when it is set.
#[serde_as]
#[derive(Debug, Clone, Deserialize)]
pub struct OidcConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    /// When well_known_url is set, discovery is fetched from it
    /// and optional metadata values below override discovered values.
    /// Discovery document URL. If unset, metadata values must all be set.
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub well_known_url: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub issuer_url: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub authorization_endpoint: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub token_endpoint: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub userinfo_endpoint: Option<String>,
    #[serde_as(as = "NoneAsEmptyString")]
    #[serde(default)]
    pub jwks_uri: Option<String>,
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreClientAuthMethod>, _)>>")]
    #[serde(default)]
    pub token_endpoint_auth_methods_supported: Option<Vec<CoreClientAuthMethod>>,
    #[serde_as(as = "PickFirst<(CommaOrSpaceSeparated<String>, _)>")]
    #[serde(default = "default_scopes")]
    pub scopes: Vec<String>,
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreJwsSigningAlgorithm>, _)>>")]
    #[serde(default)]
    pub id_token_signing_alg_values_supported: Option<Vec<CoreJwsSigningAlgorithm>>,
    /// Supported userinfo signing algorithms; may include "none" for unsigned
    /// response.
    #[serde_as(as = "Option<PickFirst<(CommaOrSpaceSeparated<CoreJwsSigningAlgorithm>, _)>>")]
    #[serde(default)]
    pub userinfo_signing_alg_values_supported: Option<Vec<CoreJwsSigningAlgorithm>>,
    #[serde(default)]
    pub claims_check_script: Option<String>,
    /// When true, use PKCE (code_challenge / code_verifier) for the
    /// authorization code flow.
    #[serde(default)]
    pub pkce_enabled: bool,
    #[serde(default = "default_redirect_url")]
    pub redirect_url: String,
    /// Configuration for the pending OAuth store.
    #[cfg(feature = "default-pending-store")]
    #[serde(default)]
    pub pending_store: Option<MokaPendingOauthStoreConfig>,
}

impl OidcConfig {
    pub fn validate(&self) -> OidcResult<()> {
        if self.claims_check_script.is_some() && cfg!(not(feature = "claims-script")) {
            return Err(OidcError::InvalidConfig {
                message: "Claims check script is enabled but the claims-script feature is disabled"
                    .to_string(),
            });
        }
        if self.well_known_url.is_none() {
            let missing: Vec<&str> = [
                ("issuer_url", self.issuer_url.as_deref()),
                (
                    "authorization_endpoint",
                    self.authorization_endpoint.as_deref(),
                ),
                ("token_endpoint", self.token_endpoint.as_deref()),
                ("jwks_uri", self.jwks_uri.as_deref()),
                ("userinfo_endpoint", self.userinfo_endpoint.as_deref()),
            ]
            .into_iter()
            .filter_map(|(name, v)| match v {
                None | Some("") => Some(name),
                Some(s) if s.trim().is_empty() => Some(name),
                _ => None,
            })
            .collect();
            if missing.len() > 1 || (missing.len() == 1 && missing[0] != "userinfo_endpoint") {
                return Err(OidcError::InvalidConfig {
                    message: format!(
                        "When well_known_url is not set, all of issuer_url, \
                         authorization_endpoint, token_endpoint, and jwks_uri must be set; \
                         userinfo_endpoint is recommended and only enables user_info_claims \
                         fetch; missing: {}",
                        missing.join(", ")
                    ),
                });
            }
        }
        Ok(())
    }
}

pub fn default_scopes() -> Vec<String> {
    vec![
        "openid".to_string(),
        "profile".to_string(),
        "email".to_string(),
    ]
}

pub fn default_id_token_signing_alg_values_supported() -> Vec<CoreJwsSigningAlgorithm> {
    vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256]
}

pub fn default_redirect_url() -> String {
    "/auth/callback".to_string()
}
