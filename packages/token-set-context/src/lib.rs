use std::{collections::HashMap, fmt, sync::Arc};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use http::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use snafu::Snafu;
use typed_builder::TypedBuilder;
use url::form_urlencoded;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationSourceKind {
    OidcAuthorizationCode,
    RefreshToken,
    ForwardedBearer,
    StaticToken,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthenticationSource {
    #[builder(default = AuthenticationSourceKind::Unknown)]
    #[serde(default)]
    pub kind: AuthenticationSourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub issuer: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
}

impl Default for AuthenticationSource {
    fn default() -> Self {
        Self {
            kind: AuthenticationSourceKind::Unknown,
            provider_id: None,
            issuer: None,
            attributes: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthenticatedPrincipal {
    #[builder(setter(into))]
    pub subject: String,
    #[builder(setter(into))]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub picture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub issuer: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub claims: HashMap<String, Value>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct SealedRefreshMaterial(String);

impl SealedRefreshMaterial {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SealedRefreshMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SealedRefreshMaterial(REDACTED)")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RefreshTokenPayload {
    pub refresh_token: SealedRefreshMaterial,
    pub redirect_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct TokenRefreshRedirectFragment {
    #[builder(setter(into))]
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub sealed_refresh_token: Option<SealedRefreshMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

impl TokenRefreshRedirectFragment {
    pub fn to_fragment(&self) -> String {
        let mut fragment = form_urlencoded::Serializer::new(String::new());

        fragment.append_pair("access_token", &self.access_token);

        if let Some(refresh_token) = self.sealed_refresh_token.as_ref() {
            fragment.append_pair("refresh_token", refresh_token.expose());
        }

        if let Some(id_token) = self.id_token.as_deref() {
            fragment.append_pair("id_token", id_token);
        }

        if let Some(access_token_expiration) = self.access_token_expires_at.as_ref() {
            fragment.append_pair("expires_at", &access_token_expiration.to_rfc3339());
        }

        fragment.finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder, Default)]
pub struct TokenSetContextConfig {
    #[builder(default)]
    #[serde(default)]
    pub master_key: Option<String>,
    #[builder(default)]
    #[serde(default)]
    pub sealed_refresh_token: bool,
}

pub trait RefreshMaterialProtector: Send + Sync {
    fn seal(&self, refresh_token: &str) -> Result<SealedRefreshMaterial, RefreshMaterialError>;
    fn unseal(&self, material: &SealedRefreshMaterial) -> Result<String, RefreshMaterialError>;
}

#[derive(Debug, Snafu)]
pub enum RefreshMaterialError {
    #[snafu(display("refresh material protector is misconfigured: {message}"))]
    InvalidConfig { message: String },
    #[snafu(display("refresh material is invalid: {message}"))]
    InvalidMaterial { message: String },
    #[snafu(display("refresh material cryptographic operation failed: {message}"))]
    Cryptography { message: String },
}

#[derive(Debug, Snafu)]
pub enum TokenSetContextError {
    #[snafu(display("token-set context is misconfigured: {message}"))]
    ContextConfig { message: String },
    #[snafu(display("refresh material operation failed: {source}"))]
    RefreshMaterial { source: RefreshMaterialError },
}

#[derive(Clone)]
pub struct TokenSetContext {
    refresh_material_protector: Arc<dyn RefreshMaterialProtector>,
}

impl fmt::Debug for TokenSetContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TokenSetContext { refresh_material_protector: REDACTED }")
    }
}

impl TokenSetContextConfig {
    pub fn validate(&self) -> Result<(), TokenSetContextError> {
        if self.sealed_refresh_token
            && self
                .master_key
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
        {
            return Err(TokenSetContextError::ContextConfig {
                message: "master_key is required when sealed_refresh_token is enabled".to_string(),
            });
        }

        Ok(())
    }
}

impl TokenSetContext {
    pub fn from_config(config: &TokenSetContextConfig) -> Result<Self, TokenSetContextError> {
        config.validate()?;

        let refresh_material_protector: Arc<dyn RefreshMaterialProtector> =
            if config.sealed_refresh_token {
                let master_key = config.master_key.as_deref().ok_or_else(|| {
                    TokenSetContextError::ContextConfig {
                        message: "master_key is required when sealed_refresh_token is enabled"
                            .to_string(),
                    }
                })?;

                Arc::new(
                    AeadRefreshMaterialProtector::from_master_key(master_key)
                        .map_err(|source| TokenSetContextError::RefreshMaterial { source })?,
                )
            } else {
                Arc::new(PassthroughRefreshMaterialProtector)
            };

        Ok(Self {
            refresh_material_protector,
        })
    }

    pub fn seal_refresh_token(
        &self,
        refresh_token: &str,
    ) -> Result<SealedRefreshMaterial, TokenSetContextError> {
        self.refresh_material_protector
            .seal(refresh_token)
            .map_err(|source| TokenSetContextError::RefreshMaterial { source })
    }

    pub fn unseal_refresh_token(
        &self,
        material: &SealedRefreshMaterial,
    ) -> Result<String, TokenSetContextError> {
        self.refresh_material_protector
            .unseal(material)
            .map_err(|source| TokenSetContextError::RefreshMaterial { source })
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct PassthroughRefreshMaterialProtector;

impl RefreshMaterialProtector for PassthroughRefreshMaterialProtector {
    fn seal(&self, refresh_token: &str) -> Result<SealedRefreshMaterial, RefreshMaterialError> {
        Ok(SealedRefreshMaterial::new(refresh_token))
    }

    fn unseal(&self, material: &SealedRefreshMaterial) -> Result<String, RefreshMaterialError> {
        Ok(material.expose().to_string())
    }
}

pub struct AeadRefreshMaterialProtector {
    master_key: orion::aead::SecretKey,
}

impl fmt::Debug for AeadRefreshMaterialProtector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AeadRefreshMaterialProtector(REDACTED)")
    }
}

impl AeadRefreshMaterialProtector {
    pub fn from_master_key(master_key: &str) -> Result<Self, RefreshMaterialError> {
        let master_key =
            orion::aead::SecretKey::from_slice(master_key.as_bytes()).map_err(|e| {
                RefreshMaterialError::InvalidConfig {
                    message: format!("failed to parse master key: {e}"),
                }
            })?;

        Ok(Self { master_key })
    }
}

impl RefreshMaterialProtector for AeadRefreshMaterialProtector {
    fn seal(&self, refresh_token: &str) -> Result<SealedRefreshMaterial, RefreshMaterialError> {
        let ciphertext =
            orion::aead::seal(&self.master_key, refresh_token.as_bytes()).map_err(|e| {
                RefreshMaterialError::Cryptography {
                    message: format!("failed to seal refresh token: {e}"),
                }
            })?;

        Ok(SealedRefreshMaterial::new(
            URL_SAFE_NO_PAD.encode(ciphertext),
        ))
    }

    fn unseal(&self, material: &SealedRefreshMaterial) -> Result<String, RefreshMaterialError> {
        let ciphertext = URL_SAFE_NO_PAD.decode(material.expose()).map_err(|e| {
            RefreshMaterialError::InvalidMaterial {
                message: format!("failed to decode sealed refresh token: {e}"),
            }
        })?;

        let plaintext = orion::aead::open(&self.master_key, &ciphertext).map_err(|e| {
            RefreshMaterialError::Cryptography {
                message: format!("failed to unseal refresh token: {e}"),
            }
        })?;

        String::from_utf8(plaintext).map_err(|e| RefreshMaterialError::InvalidMaterial {
            message: format!("unsealed refresh token is not valid UTF-8: {e}"),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BearerPropagationPolicy {
    TransparentForward,
    ValidateThenForward,
    ExchangeForDownstreamToken,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct ManagedTokenSet {
    #[builder(setter(into))]
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub sealed_refresh_token: Option<SealedRefreshMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub access_token_expires_at: Option<DateTime<Utc>>,
    #[builder(default)]
    #[serde(default)]
    pub source: AuthenticationSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub principal: Option<AuthenticatedPrincipal>,
    #[builder(default = BearerPropagationPolicy::ValidateThenForward)]
    #[serde(default = "default_bearer_propagation_policy")]
    pub bearer_propagation_policy: BearerPropagationPolicy,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
}

fn default_bearer_propagation_policy() -> BearerPropagationPolicy {
    BearerPropagationPolicy::ValidateThenForward
}

impl ManagedTokenSet {
    pub fn access_token_is_expired_at(&self, now: DateTime<Utc>) -> bool {
        self.access_token_expires_at
            .is_some_and(|expires_at| expires_at <= now)
    }

    pub fn should_refresh_at(&self, now: DateTime<Utc>) -> bool {
        self.access_token_is_expired_at(now)
            || self
                .access_token_expires_at
                .is_some_and(|expires_at| expires_at <= now + chrono::TimeDelta::minutes(1))
    }

    pub fn authorization_value(&self) -> String {
        format!("Bearer {}", self.access_token)
    }

    pub fn authorization_header_value(
        &self,
    ) -> Result<HeaderValue, http::header::InvalidHeaderValue> {
        HeaderValue::from_str(&self.authorization_value())
    }

    pub fn apply_authorization_header(
        &self,
        headers: &mut HeaderMap,
    ) -> Result<(), http::header::InvalidHeaderValue> {
        headers.insert(AUTHORIZATION, self.authorization_header_value()?);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeDelta, Utc};
    use http::HeaderMap;

    use super::{
        AeadRefreshMaterialProtector, AuthenticatedPrincipal, AuthenticationSource,
        AuthenticationSourceKind, BearerPropagationPolicy, ManagedTokenSet,
        PassthroughRefreshMaterialProtector, RefreshMaterialProtector, SealedRefreshMaterial,
        TokenSetContext, TokenSetContextConfig,
    };

    #[test]
    fn refresh_material_debug_is_redacted() {
        let value = SealedRefreshMaterial::new("sealed-token");

        assert_eq!(format!("{value:?}"), "SealedRefreshMaterial(REDACTED)");
        assert_eq!(value.expose(), "sealed-token");
    }

    #[test]
    fn token_set_marks_expiring_token_for_refresh() {
        let now = Utc::now();
        let token_set = ManagedTokenSet::builder()
            .access_token("access-token")
            .access_token_expires_at(now + TimeDelta::seconds(30))
            .build();

        assert!(token_set.should_refresh_at(now));
        assert!(!token_set.access_token_is_expired_at(now));
    }

    #[test]
    fn token_set_applies_authorization_header() {
        let token_set = ManagedTokenSet::builder()
            .access_token("access-token")
            .build();
        let mut headers = HeaderMap::new();

        token_set
            .apply_authorization_header(&mut headers)
            .expect("header should be valid");

        assert_eq!(headers["authorization"], "Bearer access-token");
    }

    #[test]
    fn builder_supports_principal_source_and_policy() {
        let token_set = ManagedTokenSet::builder()
            .access_token("access-token")
            .id_token("id-token")
            .sealed_refresh_token(SealedRefreshMaterial::new("sealed-refresh"))
            .source(
                AuthenticationSource::builder()
                    .kind(AuthenticationSourceKind::OidcAuthorizationCode)
                    .provider_id("primary")
                    .issuer("https://issuer.example.com")
                    .build(),
            )
            .principal(
                AuthenticatedPrincipal::builder()
                    .subject("user-123")
                    .display_name("Alice")
                    .issuer("https://issuer.example.com")
                    .build(),
            )
            .bearer_propagation_policy(BearerPropagationPolicy::TransparentForward)
            .build();

        assert_eq!(token_set.id_token.as_deref(), Some("id-token"));
        assert_eq!(
            token_set.sealed_refresh_token.as_ref().map(|v| v.expose()),
            Some("sealed-refresh")
        );
        assert_eq!(
            token_set.source.kind,
            AuthenticationSourceKind::OidcAuthorizationCode
        );
        assert_eq!(
            token_set.bearer_propagation_policy,
            BearerPropagationPolicy::TransparentForward
        );
    }

    #[test]
    fn passthrough_protector_round_trips_plaintext() {
        let protector = PassthroughRefreshMaterialProtector;
        let sealed = protector
            .seal("refresh-token")
            .expect("seal should succeed");

        assert_eq!(sealed.expose(), "refresh-token");
        assert_eq!(
            protector.unseal(&sealed).expect("unseal should succeed"),
            "refresh-token"
        );
    }

    #[test]
    fn aead_protector_round_trips_base64_material() {
        let protector =
            AeadRefreshMaterialProtector::from_master_key("01234567890123456789012345678901")
                .expect("master key should parse");
        let sealed = protector
            .seal("refresh-token")
            .expect("seal should succeed");

        assert_ne!(sealed.expose(), "refresh-token");
        assert!(
            sealed
                .expose()
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        );
        assert_eq!(
            protector.unseal(&sealed).expect("unseal should succeed"),
            "refresh-token"
        );
    }

    #[test]
    fn token_set_context_config_requires_master_key_when_sealing_is_enabled() {
        let error = TokenSetContextConfig {
            master_key: None,
            sealed_refresh_token: true,
        }
        .validate()
        .expect_err("config should be rejected");

        assert!(format!("{error}").contains("master_key is required"));
    }

    #[test]
    fn token_set_context_round_trips_refresh_token() {
        let context = TokenSetContext::from_config(&TokenSetContextConfig {
            master_key: Some("01234567890123456789012345678901".to_string()),
            sealed_refresh_token: true,
        })
        .expect("context should build");
        let sealed = context
            .seal_refresh_token("refresh-token")
            .expect("seal should succeed");

        assert_eq!(
            context
                .unseal_refresh_token(&sealed)
                .expect("unseal should succeed"),
            "refresh-token"
        );
    }
}
