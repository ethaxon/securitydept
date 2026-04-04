use std::collections::HashMap;

use chrono::{DateTime, Utc};
use http::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use typed_builder::TypedBuilder;

use crate::backend_oidc_mediated_mode::SealedRefreshMaterial;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder, Default)]
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[builder(default)]
    pub kind_history: Vec<AuthenticationSourceKind>,
    #[serde(flatten)]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthTokenSnapshot {
    #[builder(setter(into))]
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub refresh_material: Option<SealedRefreshMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthTokenDelta {
    #[builder(setter(into))]
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub refresh_material: Option<SealedRefreshMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder, Default)]
pub struct AuthStateMetadataSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub principal: Option<AuthenticatedPrincipal>,
    #[builder(default)]
    #[serde(default)]
    pub source: AuthenticationSource,
    #[serde(flatten, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder, Default)]
pub struct CurrentAuthenticationSourcePartial {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub kind: Option<AuthenticationSourceKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub issuer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub kind_history: Option<Vec<AuthenticationSourceKind>>,
    #[serde(default, flatten, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder, Default)]
pub struct CurrentAuthStateMetadataSnapshotPartial {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub principal: Option<AuthenticatedPrincipal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub source: Option<CurrentAuthenticationSourcePartial>,
    #[serde(default, flatten, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder, Default)]
pub struct AuthStateMetadataDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub principal: Option<AuthenticatedPrincipal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub source: Option<AuthenticationSource>,
    #[serde(default, flatten, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub attributes: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthStateSnapshot {
    pub tokens: AuthTokenSnapshot,
    pub metadata: AuthStateMetadataSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthStateDelta {
    pub tokens: AuthTokenDelta,
    #[builder(default)]
    #[serde(
        default,
        flatten,
        skip_serializing_if = "AuthStateMetadataDelta::is_empty"
    )]
    pub metadata: AuthStateMetadataDelta,
}

impl AuthTokenSnapshot {
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

impl AuthStateMetadataDelta {
    pub fn is_empty(&self) -> bool {
        self.principal.is_none() && self.source.is_none() && self.attributes.is_empty()
    }
}
