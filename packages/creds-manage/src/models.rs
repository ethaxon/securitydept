use std::collections::HashMap;

use chrono::{DateTime, Utc};
use securitydept_creds::{
    Argon2BasicAuthCred, BasicAuthCred, Sha256TokenAuthCred, StaticTokenAuthCred,
    token::TokenAuthCred,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The kind of authentication entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthEntryKind {
    Basic,
    Token,
}

/// An authentication entry (basic auth or token auth).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthEntryMeta {
    pub id: String,
    pub name: String,
    /// Group IDs this entry belongs to.
    #[serde(default)]
    pub group_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "basic")]
pub struct BasicAuthEntry {
    #[serde(flatten)]
    pub cred: Argon2BasicAuthCred,
    #[serde(flatten)]
    pub meta: AuthEntryMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename = "token")]
pub struct TokenAuthEntry {
    #[serde(flatten)]
    pub cred: Sha256TokenAuthCred,
    #[serde(flatten)]
    pub meta: AuthEntryMeta,
}

impl BasicAuthCred for BasicAuthEntry {
    fn username(&self) -> &str {
        self.cred.username()
    }

    fn display_name(&self) -> &str {
        &self.meta.name
    }

    fn verify_password(&self, password: &str) -> securitydept_creds::CredsResult<bool> {
        self.cred.verify_password(password)
    }
}

impl TokenAuthCred for TokenAuthEntry {
    fn verify_token(&self, token: &str) -> securitydept_creds::CredsResult<bool> {
        self.cred.verify_token(token)
    }
}

impl StaticTokenAuthCred for TokenAuthEntry {
    fn token_hash(&self) -> &str {
        self.cred.token_hash()
    }
}

impl AuthEntryMeta {
    pub fn new(name: String, group_ids: Vec<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.clone(),
            group_ids,
            created_at: now,
            updated_at: now,
        }
    }
}

/// A named group that auth entries can belong to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
}

impl Group {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
        }
    }
}

pub const DATA_FILE_VERSION: u32 = 2;

/// Top-level data structure persisted to the data file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataFile {
    pub version: u32,
    pub groups: Vec<Group>,
    pub basic_creds: Vec<BasicAuthEntry>,
    pub token_creds: Vec<TokenAuthEntry>,
}

impl Default for DataFile {
    fn default() -> Self {
        Self {
            version: DATA_FILE_VERSION,
            groups: Vec::new(),
            basic_creds: Vec::new(),
            token_creds: Vec::new(),
        }
    }
}

/// Unified auth entry view for API/CLI responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthEntry {
    #[serde(flatten)]
    pub meta: AuthEntryMeta,
    pub kind: AuthEntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

impl From<&BasicAuthEntry> for AuthEntry {
    fn from(value: &BasicAuthEntry) -> Self {
        Self {
            meta: value.meta.clone(),
            kind: AuthEntryKind::Basic,
            username: Some(value.cred.username.clone()),
        }
    }
}

impl From<&TokenAuthEntry> for AuthEntry {
    fn from(value: &TokenAuthEntry) -> Self {
        Self {
            meta: value.meta.clone(),
            kind: AuthEntryKind::Token,
            username: None,
        }
    }
}

/// Request payload for creating a basic auth entry.
#[derive(Debug, Deserialize)]
pub struct CreateBasicEntryRequest {
    pub name: String,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub group_ids: Vec<String>,
}

/// Response after creating a token auth entry (includes the plaintext token
/// once).
#[derive(Debug, Serialize)]
pub struct CreateBasicEntryResponse {
    #[serde(flatten)]
    pub entry: AuthEntry,
}

/// Request payload for creating a token auth entry.
#[derive(Debug, Deserialize)]
pub struct CreateTokenEntryRequest {
    pub name: String,
    #[serde(default)]
    pub group_ids: Vec<String>,
}

/// Response after creating a token auth entry (includes the plaintext token
/// once).
#[derive(Debug, Serialize)]
pub struct CreateTokenEntryResponse {
    #[serde(flatten)]
    pub entry: AuthEntry,
    pub token: String,
}

/// Request payload for updating an auth entry.
#[derive(Debug, Deserialize)]
pub struct UpdateEntryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_ids: Option<Vec<String>>,
}

/// Request payload for creating a group.
#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_ids: Option<Vec<String>>,
}

/// Request payload for updating a group.
#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_ids: Option<Vec<String>>,
}

/// Info about the currently logged-in user.
#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub claims: HashMap<String, serde_json::Value>,
}
